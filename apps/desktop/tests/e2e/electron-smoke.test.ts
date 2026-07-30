import { _electron as electron, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const electronExecutable = require('electron') as string;
const desktopRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const execFile = promisify(execFileCallback);
const PLANNING_PROMPT_IDS = [
  'planning.generate_global_outline_text',
  'planning.generate_volume_outline_text',
  'planning.generate_arc_map_minimal_json',
  'planning.generate_chapter_queue_minimal_json'
] as const;
const CHAPTER_PROMPT_IDS = [
  'planning.plan_chapter_mission_slim',
  'planning.generate_plan_candidates_slim',
  'planning.rank_plan_candidates_slim',
  'planning.generate_scene_cards_slim',
  'production.write_scene',
  'production.write_scene'
] as const;
const FULL_DRAFT_PROMPT_IDS = [
  ...PLANNING_PROMPT_IDS,
  ...CHAPTER_PROMPT_IDS
] as const;
const JSON_SCHEMA_BY_PROMPT = {
  'planning.generate_arc_map_minimal_json':
    'planning.arc_map.slim.schema.json',
  'planning.generate_chapter_queue_minimal_json':
    'planning.chapter_queue.slim.schema.json',
  'planning.plan_chapter_mission_slim':
    'planning.chapter_mission.slim.schema.json',
  'planning.generate_plan_candidates_slim':
    'planning.plan_candidates.slim.schema.json',
  'planning.rank_plan_candidates_slim':
    'planning.ranking.slim.schema.json',
  'planning.generate_scene_cards_slim':
    'drafting.scene_cards.slim.schema.json'
} as const;

function readKernelSetting(settingPath: string): string | null {
  try {
    return readFileSync(settingPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function secureSandboxBlocker(): string | null {
  if (process.platform !== 'linux') {
    return null;
  }

  const sandboxPath = path.join(
    path.dirname(electronExecutable),
    'chrome-sandbox'
  );

  try {
    const sandbox = statSync(sandboxPath);
    const hasSetuidSandbox = sandbox.uid === 0
      && (sandbox.mode & 0o4000) === 0o4000;
    if (hasSetuidSandbox) {
      return null;
    }
  } catch {
    // A usable user-namespace sandbox does not require the SUID helper.
  }

  const unprivilegedUserNamespaces = readKernelSetting(
    '/proc/sys/kernel/unprivileged_userns_clone'
  );
  const appArmorRestriction = readKernelSetting(
    '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
  );

  if (unprivilegedUserNamespaces === '1' && appArmorRestriction !== '1') {
    return null;
  }

  return [
    'Secure Electron sandbox is unavailable on this Linux host.',
    'The smoke test will not use --no-sandbox or --disable-setuid-sandbox.'
  ].join(' ');
}

test('boots with the narrow preload API and blocks renderer privilege escape', async () => {
  const blocker = secureSandboxBlocker();
  if (
    blocker !== null
    && process.env['NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE'] === '1'
  ) {
    throw new Error(blocker);
  }
  test.skip(blocker !== null, blocker ?? '');

  const electronEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => (
        ![
          'ELECTRON_RENDERER_URL',
          'VITE_DEV_SERVER_URL'
        ].includes(entry[0])
        && typeof entry[1] === 'string'
      )
    )
  );
  const temporaryUserDataDirectory = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-smoke-')
  );
  electronEnvironment['PATH'] = temporaryUserDataDirectory;

  try {
    const application = await electron.launch({
      args: [
        `--user-data-dir=${temporaryUserDataDirectory}`,
        desktopRoot
      ],
      cwd: desktopRoot,
      env: electronEnvironment
    });

    try {
      const page = await application.firstWindow();
      await expect(page.getByText('Novel Loop').first()).toBeVisible();

      const boundary = await page.evaluate(async () => ({
        apiKeys: Object.keys(window.novelLoop),
        hasReadinessMethod:
          typeof window.novelLoop.system.getReadiness === 'function',
        nodeProcessType: typeof globalThis.process,
        nodeRequireType: typeof globalThis.require,
        notificationPermission: (
          await navigator.permissions.query({ name: 'notifications' })
        ).state,
        projectLibrary: await window.novelLoop.projects.list(),
        chapterKeys: Object.keys(window.novelLoop.chapter),
        foundationKeys: Object.keys(window.novelLoop.foundation),
        planningKeys: Object.keys(window.novelLoop.planning),
        projectKeys: Object.keys(window.novelLoop.projects),
        systemKeys: Object.keys(window.novelLoop.system)
      }));

      expect(boundary).toEqual({
        apiKeys: ['system', 'projects', 'foundation', 'planning', 'chapter'],
        chapterKeys: [
          'inspect',
          'startPlanning',
          'startDrafting',
          'get',
          'cancel',
          'readPlan',
          'readDraft'
        ],
        hasReadinessMethod: true,
        nodeProcessType: 'undefined',
        nodeRequireType: 'undefined',
        notificationPermission: 'denied',
        projectLibrary: {
          projects: [],
          defaultLocation: {
            configured: false,
            locationLabel: null
          },
          warning: null
        },
        projectKeys: [
          'list',
          'chooseDefaultLibrary',
          'create',
          'openExisting',
          'open',
          'remove'
        ],
        foundationKeys: ['start', 'get', 'cancel', 'read'],
        planningKeys: ['start', 'get', 'cancel', 'read'],
        systemKeys: ['getReadiness']
      });

      const popupWasDenied = await page.evaluate(
        () => window.open('https://example.com') === null
      );
      expect(popupWasDenied).toBe(true);

      const originalUrl = page.url();
      await page.evaluate(() => {
        window.location.href = 'https://example.com';
      });
      await page.waitForTimeout(250);
      expect(page.url()).toBe(originalUrl);
    } finally {
      await application.close();
    }
  } finally {
    await rm(temporaryUserDataDirectory, {
      force: true,
      recursive: true
    });
  }
});

test('authors can create chapter one through planning review and initial draft without changing Story State', async () => {
  test.setTimeout(120_000);
  const blocker = secureSandboxBlocker();
  if (
    blocker !== null
    && process.env['NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE'] === '1'
  ) {
    throw new Error(blocker);
  }
  test.skip(blocker !== null, blocker ?? '');

  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-planning-')
  );
  const projectsRoot = path.join(temporaryRoot, 'projects');
  const userDataDirectory = path.join(temporaryRoot, 'user-data');
  const projectId = 'desktop-planning-e2e';
  const projectKey = 'project_desktop_planning_e2e';
  const projectRoot = path.join(projectsRoot, projectId);
  const briefPath = path.join(temporaryRoot, 'brief.md');
  const fake = await writePlanningFakeCodex(temporaryRoot);

  try {
    await mkdir(projectsRoot, { recursive: true });
    await writeFile(briefPath, [
      '# Electron Planning Test',
      '',
      '## Core Idea',
      '',
      'A powerless radio leads a tenant into an old building mystery.'
    ].join('\n'));
    await runCli([
      'init',
      projectId,
      '--brief',
      briefPath,
      '--root',
      projectsRoot
    ]);
    await runCli([
      'build-bible',
      projectId,
      '--provider',
      'mock',
      '--root',
      projectsRoot
    ]);

    const storyStateHashBefore = await sha256(
      path.join(projectRoot, 'state', 'story_state.json')
    );
    await writeProjectRegistry({
      projectId,
      projectKey,
      projectRoot,
      projectsRoot,
      userDataDirectory
    });

    const application = await electron.launch({
      args: [
        `--user-data-dir=${userDataDirectory}`,
        desktopRoot
      ],
      cwd: desktopRoot,
      env: electronEnvironment({
        NLE_CODEX_BIN: fake.codexBin
      })
    });

    try {
      const page = await application.firstWindow();
      await page.getByRole('button', { name: '进入作品库' }).click();
      await page.getByRole('button', { name: '打开《Electron Planning Test》' }).click();

      await expect(page.getByRole('heading', { name: 'Electron Planning Test' })).toBeVisible();
      await page.getByRole('button', { name: '查看故事基础' }).click();
      await expect(page.getByRole('heading', { name: '故事基础' })).toBeVisible();
      await expect(page.getByText('故事核心', { exact: true })).toBeVisible();

      await page.getByRole('button', {
        name: '确认故事基础并生成全局规划'
      }).click();
      await expect(page.getByRole('heading', { name: '生成全局规划' })).toBeVisible();
      await page.getByRole('button', { name: '开始生成全局规划' }).click();

      await expect(page.getByLabel('全局规划生成阶段')).toBeVisible();
      await expect(page.getByText('正在读取故事基础')).toBeVisible();

      await expect(page.getByRole('heading', {
        name: '全局规划',
        exact: true
      })).toBeVisible({
        timeout: 45_000
      });
      await expect(page.getByRole('tab', { name: '全书方向' })).toBeVisible();
      await expect(page.getByText('Codex Global Outline')).toBeVisible();

      await page.getByRole('tab', { name: '第一卷' }).click();
      await expect(page.getByText('Codex Volume 01 Outline')).toBeVisible();
      await page.getByRole('tab', { name: '故事线' }).click();
      await expect(page.getByRole('heading', { name: 'Radio Signal' })).toBeVisible();
      await page.getByRole('tab', { name: '章节计划' }).click();
      await expect(page.getByText('第 1 章 The Radio Wakes')).toBeVisible();

      await page.getByRole('button', { name: '创建第 1 章' }).click();
      await expect(page.getByRole('heading', {
        name: '准备第 1 章方向'
      })).toBeVisible();
      await page.getByRole('button', {
        name: '开始准备章节方向'
      }).click();

      await expect(page.getByRole('heading', {
        name: '审阅第 1 章方向'
      })).toBeVisible({
        timeout: 45_000
      });
      await expect(page.getByRole('heading', { name: '本章任务' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '必须完成' })).toBeVisible();
      await expect(page.getByRole('heading', {
        name: '推进的悬念与承诺'
      })).toBeVisible();
      await expect(page.getByRole('heading', { name: '人物变化' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '读者会知道' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '本章不能做' })).toBeVisible();
      await expect(page.getByText('选定方向：Plan 001')).toBeVisible();

      await page.getByRole('button', {
        name: '确认方向并生成草稿'
      }).click();
      await expect(page.getByRole('heading', {
        name: '确认开始生成初稿'
      })).toBeFocused();
      await page.getByRole('button', { name: '开始生成草稿' }).click();

      await expect(page.getByText('初稿', { exact: true })).toBeVisible({
        timeout: 45_000
      });
      await expect(page.getByRole('heading', {
        name: '第 1 章 The Radio Wakes'
      })).toBeVisible();
      await expect(page.getByText(
        '当前只是初稿，尚未写入正式故事状态。'
      )).toBeVisible();

      const boundary = await page.evaluate(() => ({
        apiKeys: Object.keys(window.novelLoop),
        chapterKeys: Object.keys(window.novelLoop.chapter),
        nodeProcessType: typeof globalThis.process,
        nodeRequireType: typeof globalThis.require
      }));
      expect(boundary).toEqual({
        apiKeys: ['system', 'projects', 'foundation', 'planning', 'chapter'],
        chapterKeys: [
          'inspect',
          'startPlanning',
          'startDrafting',
          'get',
          'cancel',
          'readPlan',
          'readDraft'
        ],
        nodeProcessType: 'undefined',
        nodeRequireType: 'undefined'
      });
    } finally {
      await application.close();
    }

    const calls = await readPlanningFakeCalls(
      path.join(temporaryRoot, 'planning-codex-calls.ndjson')
    );
    expect(calls.map((call) => call.promptId)).toEqual(FULL_DRAFT_PROMPT_IDS);
    expect(calls).toHaveLength(FULL_DRAFT_PROMPT_IDS.length);
    for (const call of calls) {
      expect(call.outputPath.startsWith(`${projectRoot}${path.sep}`)).toBe(true);
      expect(call.args).toContain('--sandbox');
      expect(call.args[call.args.indexOf('--sandbox') + 1]).toBe('read-only');
      expect(call.args).toContain('--ask-for-approval');
      expect(call.args[call.args.indexOf('--ask-for-approval') + 1]).toBe('never');
      expect(call.args).not.toEqual(expect.arrayContaining([
        'workspace-write',
        'danger-full-access',
        '--dangerously-bypass-approvals-and-sandbox',
        '--bypass-approvals-and-sandbox',
        '--no-sandbox'
      ]));
      const schemaName = JSON_SCHEMA_BY_PROMPT[
        call.promptId as keyof typeof JSON_SCHEMA_BY_PROMPT
      ];
      if (schemaName === undefined) {
        expect(call.args).not.toContain('--output-schema');
      } else {
        const schemaIndex = call.args.indexOf('--output-schema');
        expect(schemaIndex).toBeGreaterThan(-1);
        expect(call.args[schemaIndex + 1]).toBe(
          path.join(
            repositoryRoot,
            'schemas',
            'codex-output',
            'slim',
            schemaName
          )
        );
      }
    }
    for (const expectedPlanningArtifact of [
      'mission.json',
      path.join('plan_candidates', 'plan_001.md'),
      path.join('plan_candidates', 'plan_002.md'),
      path.join('plan_candidates', 'plan_003.md'),
      'ranking.json',
      'selected_plan.md',
      'scene_cards.json'
    ]) {
      await expect(readFile(
        path.join(
          projectRoot,
          'chapters',
          'chapter_001',
          expectedPlanningArtifact
        ),
        'utf8'
      )).resolves.not.toHaveLength(0);
    }
    const sceneCards = JSON.parse(
      await readFile(
        path.join(projectRoot, 'chapters', 'chapter_001', 'scene_cards.json'),
        'utf8'
      )
    ) as Array<{ sceneId: string }>;
    expect(sceneCards.map((scene) => scene.sceneId)).toEqual([
      'scene_001',
      'scene_002'
    ]);
    await expect(readFile(
      path.join(projectRoot, 'chapters', 'chapter_001', 'draft_v1.md'),
      'utf8'
    )).resolves.toContain('# Chapter 001 Draft');
    await expect(readFile(
      path.join(projectRoot, 'chapters', 'chapter_001', 'scenes', 'scene_001.md'),
      'utf8'
    )).resolves.toContain('Codex scene 1');
    await expect(readFile(
      path.join(projectRoot, 'chapters', 'chapter_001', 'scenes', 'scene_002.md'),
      'utf8'
    )).resolves.toContain('Codex scene 2');
    for (const forbiddenArtifact of [
      'diagnostics_v1.json',
      'revision_plan_v1.json',
      'final.md',
      'canon_patch.json',
      'commit_report.json'
    ]) {
      await expect(readFile(
        path.join(projectRoot, 'chapters', 'chapter_001', forbiddenArtifact),
        'utf8'
      )).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(sha256(path.join(projectRoot, 'state', 'story_state.json')))
      .resolves.toBe(storyStateHashBefore);
    const storyState = JSON.parse(
      await readFile(
        path.join(projectRoot, 'state', 'story_state.json'),
        'utf8'
      )
    ) as { latestCommittedChapter: number };
    expect(storyState.latestCommittedChapter).toBe(0);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('chapter-flow fake Codex rejects unknown commands, prompts, schemas, operations, and unsafe execution flags', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-fake-codex-')
  );
  const projectRoot = path.join(temporaryRoot, 'projects', 'desktop-planning-e2e');
  const outputPath = path.join(projectRoot, 'codex', 'runs', 'test', 'final_output.md');
  const jsonOutputPath = path.join(projectRoot, 'codex', 'runs', 'test-json', 'final_output.json');
  const untrustedSchemaPath = path.join(
    temporaryRoot,
    'untrusted',
    'schemas',
    'codex-output',
    'slim',
    'planning.arc_map.slim.schema.json'
  );
  const fake = await writePlanningFakeCodex(temporaryRoot);

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await mkdir(path.dirname(jsonOutputPath), { recursive: true });
    await expect(runFakeCodex(fake.codexBin, ['unsupported-command'], '')).rejects.toThrow(
      'Unknown fake Codex command'
    );
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      outputPath,
      '-'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[1]}\n`)).rejects.toThrow(
      'Unknown or out-of-order fake Codex prompt'
    );
    for (const forbiddenPromptId of [
      'planning.unknown_stage',
      'revision.final_chapter',
      'memory.extract_canon_patch_proposal_slim',
      'chapter.commit',
      'chapter.recommit',
      'chapter.regenerate_stale',
      'provider.openai',
      'shell.exec'
    ]) {
      await expect(runFakeCodex(fake.codexBin, [
        '--ask-for-approval',
        'never',
        'exec',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--json',
        '--output-last-message',
        outputPath,
        '-'
      ], `PROMPT_ID: ${forbiddenPromptId}\n`)).rejects.toThrow(
        'Unknown or out-of-order fake Codex prompt'
      );
    }
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'danger-full-access',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      outputPath,
      '-'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}\n`)).rejects.toThrow(
      'Unsafe Codex execution arguments'
    );
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      outputPath,
      '-',
      '--model',
      'unexpected'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}\n`)).rejects.toThrow(
      'Unexpected Codex execution arguments'
    );
    for (const forbiddenArguments of [
      ['--provider', 'mock'],
      ['--shell', 'bash'],
      ['--commit'],
      ['--final'],
      ['--patch'],
      ['--recommit'],
      ['--regenerate-stale']
    ]) {
      await expect(runFakeCodex(fake.codexBin, [
        '--ask-for-approval',
        'never',
        'exec',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--json',
        '--output-last-message',
        outputPath,
        '-',
        ...forbiddenArguments
      ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}\n`)).rejects.toThrow(
        'Unexpected Codex execution arguments'
      );
    }
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      outputPath,
      '-'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}\n`)).resolves.toBeUndefined();
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      outputPath,
      '-'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[1]}\n`)).resolves.toBeUndefined();
    await expect(runFakeCodex(fake.codexBin, [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '--output-last-message',
      jsonOutputPath,
      '--output-schema',
      untrustedSchemaPath,
      '-'
    ], `PROMPT_ID: ${PLANNING_PROMPT_IDS[2]}\n`)).rejects.toThrow(
      'Unexpected Codex execution arguments'
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

function electronEnvironment(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => (
          ![
            'ELECTRON_RENDERER_URL',
            'VITE_DEV_SERVER_URL'
          ].includes(entry[0])
          && typeof entry[1] === 'string'
        )
      )
    ),
    ...overrides
  };
}

async function runCli(args: string[]): Promise<void> {
  await execFile(
    process.execPath,
    [path.join(repositoryRoot, 'dist', 'cli', 'index.js'), ...args],
    {
      cwd: repositoryRoot,
      env: process.env,
      timeout: 15_000
    }
  );
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function readPlanningFakeCalls(filePath: string): Promise<Array<{
  args: string[];
  outputPath: string;
  promptId: string;
}>> {
  const contents = await readFile(filePath, 'utf8');
  return contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    args: string[];
    outputPath: string;
    promptId: string;
  });
}

async function runFakeCodex(
  binaryPath: string,
  args: string[],
  prompt: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `fake Codex exited with ${code ?? 'null'}`));
    });
    child.stdin.end(prompt);
  });
}

async function writeProjectRegistry(input: {
  projectId: string;
  projectKey: string;
  projectRoot: string;
  projectsRoot: string;
  userDataDirectory: string;
}): Promise<void> {
  const timestamp = '2026-07-29T00:00:00.000Z';
  await mkdir(input.userDataDirectory, { recursive: true });
  await writeFile(
    path.join(input.userDataDirectory, 'project-library.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      defaultLibraryRoot: input.projectsRoot,
      projects: [{
        projectKey: input.projectKey,
        projectRoot: input.projectRoot,
        title: 'Electron Planning Test',
        addedAt: timestamp,
        lastOpenedAt: timestamp
      }]
    }, null, 2)}\n`
  );
}

async function writePlanningFakeCodex(root: string): Promise<{ codexBin: string }> {
  const codexBin = path.join(root, 'codex');
  const callsLogPath = path.join(root, 'planning-codex-calls.ndjson');
  const statePath = path.join(root, 'planning-codex-state.json');
  const expectedProjectRoot = path.join(
    root,
    'projects',
    'desktop-planning-e2e'
  );
  const expectedSchemaRoot = path.join(repositoryRoot, 'schemas', 'codex-output');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const expectedPromptIds = ${JSON.stringify(FULL_DRAFT_PROMPT_IDS)};
const callsLogPath = ${JSON.stringify(callsLogPath)};
const statePath = ${JSON.stringify(statePath)};
const expectedProjectRoot = path.resolve(${JSON.stringify(expectedProjectRoot)});
const expectedSchemaRoot = path.resolve(${JSON.stringify(expectedSchemaRoot)});
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args.length === 2 && args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in as fake-codex@example.com\\n');
  process.exit(0);
}
if (args.length === 2 && args[0] === 'doctor' && args[1] === '--json') {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (!args.includes('exec')) {
  process.stderr.write('Unknown fake Codex command');
  process.exit(2);
}
const unsafeArguments = [
  'workspace-write',
  '--workspace-write',
  'danger-full-access',
  '--dangerously-bypass-approvals-and-sandbox',
  '--bypass-approval-and-sandbox',
  '--bypass-approvals-and-sandbox',
  '--no-sandbox',
  '--disable-sandbox',
  '--disable-setuid-sandbox',
  '--full-auto'
];
const sandboxIndex = args.indexOf('--sandbox');
if (unsafeArguments.some((arg) => args.includes(arg))
  || sandboxIndex === -1
  || args[sandboxIndex + 1] !== 'read-only') {
  process.stderr.write('Unsafe Codex execution arguments');
  process.exit(2);
}
const stdin = fs.readFileSync(0, 'utf8');
const promptId = (stdin.match(/PROMPT_ID:\\s*([^\\n]+)/) || [])[1] || '';
const completedPromptIds = readCompletedPromptIds();
if (promptId !== expectedPromptIds[completedPromptIds.length]) {
  process.stderr.write('Unknown or out-of-order fake Codex prompt');
  process.exit(2);
}
const jsonSchemaNames = {
  'planning.generate_arc_map_minimal_json': 'planning.arc_map.slim.schema.json',
  'planning.generate_chapter_queue_minimal_json': 'planning.chapter_queue.slim.schema.json',
  'planning.plan_chapter_mission_slim': 'planning.chapter_mission.slim.schema.json',
  'planning.generate_plan_candidates_slim': 'planning.plan_candidates.slim.schema.json',
  'planning.rank_plan_candidates_slim': 'planning.ranking.slim.schema.json',
  'planning.generate_scene_cards_slim': 'drafting.scene_cards.slim.schema.json'
};
const schemaName = jsonSchemaNames[promptId];
const expectedLength = schemaName === undefined ? 11 : 13;
const commonArgumentsAreExact = (
  args.length === expectedLength
  && args[0] === '--ask-for-approval'
  && args[1] === 'never'
  && args[2] === 'exec'
  && args[3] === '--sandbox'
  && args[4] === 'read-only'
  && args[5] === '--skip-git-repo-check'
  && args[6] === '--ephemeral'
  && args[7] === '--json'
  && args[8] === '--output-last-message'
  && typeof args[9] === 'string'
);
const textArgumentsAreExact = schemaName === undefined && args[10] === '-';
const schemaPath = schemaName === undefined ? '' : path.resolve(args[11] || '');
const jsonArgumentsAreExact = schemaName !== undefined
  && args[10] === '--output-schema'
  && schemaPath === path.join(expectedSchemaRoot, 'slim', schemaName)
  && args[12] === '-';
if (!commonArgumentsAreExact || (!textArgumentsAreExact && !jsonArgumentsAreExact)) {
  process.stderr.write('Unexpected Codex execution arguments');
  process.exit(2);
}
const outputIndex = 8;
const outputPath = path.resolve(args[outputIndex + 1]);
if (outputPath !== expectedProjectRoot && !outputPath.startsWith(expectedProjectRoot + path.sep)) {
  process.stderr.write('Codex output artifact path is outside the temporary project');
  process.exit(2);
}
const outputParts = path.relative(expectedProjectRoot, outputPath).split(path.sep);
const expectedOutputName = schemaName === undefined ? 'final_output.md' : 'final_output.json';
if (
  outputParts.length !== 4
  || outputParts[0] !== 'codex'
  || outputParts[1] !== 'runs'
  || outputParts[2].length === 0
  || outputParts[3] !== expectedOutputName
) {
  process.stderr.write('Unexpected Codex output artifact path');
  process.exit(2);
}
const outputs = {
  'planning.generate_global_outline_text': '# Codex Global Outline\\n\\nA three chapter opening arc around the radio signal.\\n',
  'planning.generate_volume_outline_text': '# Codex Volume 01 Outline\\n\\nThe radio mystery escalates through the first volume.\\n',
  'planning.generate_arc_map_minimal_json': JSON.stringify({ arcs: [{ id: 'arc_radio', name: 'Radio Signal', type: 'plot', summary: 'The signal pulls Lin Cheng toward the old building.' }] }),
  'planning.generate_chapter_queue_minimal_json': JSON.stringify({ chapters: [{ chapterNumber: 1, title: 'The Radio Wakes', summary: 'The radio speaks without power.', primaryFunction: 'Open the impossible broadcast.', targetDebts: [] }, { chapterNumber: 2, title: 'The Elevator Log', summary: 'The elevator records an impossible stop.', primaryFunction: 'Escalate the building mystery.', targetDebts: [] }, { chapterNumber: 3, title: 'The Missing Floor', summary: 'Lin Cheng finds signs of a hidden floor.', primaryFunction: 'Create a strong midpoint hook.', targetDebts: [] }] }),
  'planning.plan_chapter_mission_slim': JSON.stringify({
    chapterNumber: 1,
    chapterFunction: 'Open the impossible broadcast without resolving its source.',
    objectives: [
      'Show the powerless radio speaking.',
      'Give Lin Cheng a concrete reason to investigate the old building.'
    ],
    debtsToPayOrAdvance: [],
    debtsToIntroduce: [{
      type: 'mystery',
      promise: 'Why does the radio speak without power?',
      importance: 8
    }],
    characterDeltas: [],
    readerKnowledge: ['The radio speaks while disconnected from power.'],
    readerQuestions: ['Who is sending the old building address?'],
    forbiddenMoves: ['Do not reveal the final caller identity.']
  }),
  'planning.generate_plan_candidates_slim': JSON.stringify({
    chapterNumber: 1,
    candidates: [
      {
        id: 'plan_001',
        title: 'Signal First',
        summary: 'Open on the impossible signal and end on the address.',
        markdown: '# Plan 001\\n\\nThe powerless radio interrupts Lin Cheng and repeats the address of the old building.'
      },
      {
        id: 'plan_002',
        title: 'Building First',
        summary: 'Frame the building before introducing the radio.',
        markdown: '# Plan 002\\n\\nA memory of the old building frames the first impossible broadcast.'
      },
      {
        id: 'plan_003',
        title: 'Quiet Discovery',
        summary: 'Let Lin Cheng discover the radio gradually.',
        markdown: '# Plan 003\\n\\nA quiet apartment scene slowly exposes the radio signal.'
      }
    ]
  }),
  'planning.rank_plan_candidates_slim': JSON.stringify({
    chapterNumber: 1,
    selectedCandidateId: 'plan_001',
    rationale: 'The direct impossible signal creates the clearest hook.'
  }),
  'planning.generate_scene_cards_slim': JSON.stringify({
    scenes: [
      {
        purpose: 'Establish the impossible broadcast.',
        conflict: 'Lin Cheng tests every rational explanation while the voice continues.',
        entryPoint: 'Lin Cheng sets the powerless radio on his desk.',
        exitPoint: 'The radio says the old building address.',
        location: 'Lin Cheng apartment',
        characters: ['Lin Cheng']
      },
      {
        purpose: 'Turn the broadcast into a decision.',
        conflict: 'Lin Cheng must choose whether to ignore the warning.',
        entryPoint: 'The address repeats after the room falls silent.',
        exitPoint: 'Lin Cheng writes down the address and leaves.',
        location: 'Apartment stairwell',
        characters: ['Lin Cheng']
      }
    ]
  })
};
const expectedSceneId = promptId === 'production.write_scene'
  ? 'scene_' + String(
      completedPromptIds.filter((item) => item === 'production.write_scene').length + 1
    ).padStart(3, '0')
  : null;
const sceneId = (stdin.match(/"sceneId"\\s*:\\s*"(scene_[0-9]{3})"/) || [])[1] || null;
if (expectedSceneId !== null && sceneId !== expectedSceneId) {
  process.stderr.write('Unexpected production.write_scene order or scene card');
  process.exit(2);
}
const finalText = promptId === 'production.write_scene'
  ? (
      expectedSceneId === 'scene_001'
        ? 'Codex scene 1: The powerless radio clicked awake and spoke the old building address.\\n'
        : 'Codex scene 2: Lin Cheng copied the address, left the apartment, and chose to investigate.\\n'
    )
  : outputs[promptId];
if (typeof finalText !== 'string') {
  process.stderr.write('Unknown fake Codex prompt');
  process.exit(2);
}
fs.writeFileSync(outputPath, finalText);
fs.writeFileSync(statePath, JSON.stringify([...completedPromptIds, promptId]));
fs.appendFileSync(callsLogPath, JSON.stringify({ args, outputPath, promptId }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'thread.started' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: finalText } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');

function readCompletedPromptIds() {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  } catch {
    return [];
  }
}
`;
  await writeFile(codexBin, script, { mode: 0o700 });
  await chmod(codexBin, 0o700);
  return { codexBin };
}
