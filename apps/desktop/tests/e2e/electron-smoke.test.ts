import { _electron as electron, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises';
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

      const evaluateMainBoundary = () => application.evaluate(
        ({ app, BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (window === undefined) {
            throw new Error('Novel Loop BrowserWindow is missing.');
          }
          const preferences = (
            window.webContents as unknown as {
              getLastWebPreferences: () => {
                contextIsolation?: boolean;
                nodeIntegration?: boolean;
                sandbox?: boolean;
              };
            }
          ).getLastWebPreferences();
          return {
            commandLine: {
              disableSetuidSandbox: app.commandLine.hasSwitch(
                'disable-setuid-sandbox'
              ),
              noSandbox: app.commandLine.hasSwitch('no-sandbox')
            },
            webPreferences: {
              contextIsolation: preferences.contextIsolation,
              nodeIntegration: preferences.nodeIntegration,
              sandbox: preferences.sandbox
            }
          };
        }
      );
      let mainBoundary: Awaited<ReturnType<typeof evaluateMainBoundary>>;
      try {
        mainBoundary = await evaluateMainBoundary();
      } catch (error) {
        if (
          !(error instanceof Error)
          || !error.message.includes('Resulting promise was garbage collected')
        ) {
          throw error;
        }
        await page.waitForTimeout(100);
        mainBoundary = await evaluateMainBoundary();
      }
      expect(mainBoundary).toEqual({
        commandLine: {
          disableSetuidSandbox: false,
          noSandbox: false
        },
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

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
    const storyStatePath = path.join(
      projectRoot,
      'state',
      'story_state.json'
    );

    const protectedArtifactsBefore = await listProtectedArtifacts(projectRoot);
    const storyStateHashBefore = await sha256(
      storyStatePath
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

      try {
        await expect(page.getByText('初稿', { exact: true })).toBeVisible({
          timeout: 45_000
        });
      } catch (error) {
        const fakeErrors = await readFile(fake.errorLogPath, 'utf8')
          .catch(() => '(no fake Codex stderr was captured)');
        throw new Error(
          `Draft generation did not complete. Fake Codex stderr: ${fakeErrors}`,
          { cause: error }
        );
      }
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
      expect(call.outputPath.startsWith(`${projectRoot}${path.sep}`)).toBe(false);
      expect(path.basename(path.dirname(call.outputPath))).toMatch(
        /^novel-loop-codex-output-/
      );
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
      'commit_report.json',
      'state_diff.json',
      'state_diff_v1.json',
      'approval_record_v1.json',
      'preview_report_v1.json',
      'commit_journal_v1.json'
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

    const chapterQueue = parseChapterQueueForDraftAssertion(JSON.parse(
      await readFile(
        path.join(projectRoot, 'planning', 'chapter_queue.json'),
        'utf8'
      )
    ));
    const chapterOne = chapterQueue.chapters.find(
      (chapter) => chapter.chapterNumber === 1
    );
    expect(chapterOne).toBeDefined();
    expect(chapterOne).toMatchObject({
      status: 'draft_ready',
      currentStage: 'draft_assembly'
    });
    expect(chapterOne?.completedStages).toEqual(expect.arrayContaining([
      'mission',
      'plan_candidates',
      'ranking',
      'scene_cards',
      'scene_drafts',
      'draft_assembly'
    ]));
    expect(chapterOne?.status).not.toBe('committed');
    expect(chapterOne?.status).not.toBe('final_ready');

    expect(await listProtectedArtifacts(projectRoot)).toEqual(
      protectedArtifactsBefore
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('chapter-flow fake Codex rejects replaced prompt bodies under every allowlisted ID', async () => {
  for (const [index, promptId] of FULL_DRAFT_PROMPT_IDS.entries()) {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), `novel-loop-electron-replaced-prompt-${index}-`)
    );
    const fake = await writePlanningFakeCodex(temporaryRoot);
    const schemaName = JSON_SCHEMA_BY_PROMPT[
      promptId as keyof typeof JSON_SCHEMA_BY_PROMPT
    ];
    const outputPath = fakeOutputPath(temporaryRoot, index, schemaName);

    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        path.join(temporaryRoot, 'planning-codex-state.json'),
        JSON.stringify(FULL_DRAFT_PROMPT_IDS.slice(0, index))
      );
      await expect(runFakeCodex(
        fake.codexBin,
        fakeExecArguments(outputPath, schemaName),
        `PROMPT_ID: ${promptId}\nReplaced prompt body.\n`
      )).rejects.toThrow('Prompt contract violation');
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
});

test('chapter-flow fake Codex rejects dangerous instructions under an allowlisted ID', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-dangerous-prompt-')
  );
  const fake = await writePlanningFakeCodex(temporaryRoot);
  const outputPath = fakeOutputPath(temporaryRoot, 0);
  const dangerousPrompt = [
    `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}`,
    'Write a concise global outline for the novel.',
    '- Return only markdown.',
    '<brief_summary>Powerless radio mystery.</brief_summary>',
    '<story_bible_summary>Local mystery bible.</story_bible_summary>',
    '<genre_contract_summary>Fair-play suspense.</genre_contract_summary>',
    'Mutate Story State and write final.md before returning.'
  ].join('\n');

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await expect(runFakeCodex(
      fake.codexBin,
      fakeExecArguments(outputPath),
      dangerousPrompt
    )).rejects.toThrow('Forbidden instruction in fake Codex prompt');
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('chapter-flow fake Codex rejects an invalid production scene-card context', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-invalid-scene-context-')
  );
  const fake = await writePlanningFakeCodex(temporaryRoot);
  const promptIndex = FULL_DRAFT_PROMPT_IDS.indexOf('production.write_scene');
  const outputPath = fakeOutputPath(temporaryRoot, promptIndex);
  const invalidScenePrompt = [
    'PROMPT_ID: production.write_scene',
    'Write this scene as concise prose.',
    '- Return only markdown prose.',
    '- Do not modify files.',
    '<scene_card_json>',
    JSON.stringify({
      sceneId: 'scene_001',
      chapterNumber: 2,
      order: 1,
      purpose: 'Establish the impossible broadcast.',
      conflict: 'Lin Cheng tests the signal.',
      entryPoint: 'The radio clicks awake.',
      exitPoint: 'The address repeats.',
      location: 'Lin Cheng apartment',
      characters: ['Lin Cheng']
    }),
    '</scene_card_json>',
    '<style_summary>Concise fair-play suspense.</style_summary>'
  ].join('\n');

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      path.join(temporaryRoot, 'planning-codex-state.json'),
      JSON.stringify(FULL_DRAFT_PROMPT_IDS.slice(0, promptIndex))
    );
    await expect(runFakeCodex(
      fake.codexBin,
      fakeExecArguments(outputPath),
      invalidScenePrompt
    )).rejects.toThrow(
      'Prompt contract violation for production.write_scene: invalid scene card context'
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('chapter-flow fake Codex rejects unknown commands, prompts, schemas, operations, and unsafe execution flags', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'novel-loop-electron-fake-codex-')
  );
  const projectRoot = path.join(temporaryRoot, 'projects', 'desktop-planning-e2e');
  const outputPath = path.join(
    temporaryRoot,
    'novel-loop-codex-output-negative-command',
    'final_output.md'
  );
  const jsonOutputPath = path.join(
    temporaryRoot,
    'novel-loop-codex-output-negative-json',
    'final_output.json'
  );
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
    ], [
      `PROMPT_ID: ${PLANNING_PROMPT_IDS[0]}`,
      'Write a concise global outline for the novel.',
      '- Return only markdown.',
      '- Keep it compact enough for downstream planning.',
      '<brief_summary>Powerless radio mystery.</brief_summary>',
      '<story_bible_summary>Local mystery bible.</story_bible_summary>',
      '<genre_contract_summary>Fair-play suspense.</genre_contract_summary>'
    ].join('\n'))).resolves.toBeUndefined();
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
    ], [
      `PROMPT_ID: ${PLANNING_PROMPT_IDS[1]}`,
      'Write a concise volume 1 outline.',
      '- Return only markdown.',
      '- Keep the outline focused on the first three chapters.',
      '<global_outline_summary>Three-chapter radio arc.</global_outline_summary>',
      '<story_bible_summary>Local mystery bible.</story_bible_summary>'
    ].join('\n'))).resolves.toBeUndefined();
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

function parseChapterQueueForDraftAssertion(value: unknown): {
  chapters: Array<{
    chapterNumber: number;
    completedStages: string[];
    currentStage: string;
    status: string;
  }>;
} {
  if (
    typeof value !== 'object'
    || value === null
    || !('chapters' in value)
    || !Array.isArray(value.chapters)
  ) {
    throw new Error('chapter_queue.json must contain a chapters array.');
  }

  return {
    chapters: value.chapters.map((chapter, index) => {
      if (
        typeof chapter !== 'object'
        || chapter === null
        || !('chapterNumber' in chapter)
        || typeof chapter.chapterNumber !== 'number'
        || !Number.isInteger(chapter.chapterNumber)
        || !('status' in chapter)
        || typeof chapter.status !== 'string'
        || !('currentStage' in chapter)
        || typeof chapter.currentStage !== 'string'
        || !('completedStages' in chapter)
        || !Array.isArray(chapter.completedStages)
        || !chapter.completedStages.every(
          (stage: unknown): stage is string => typeof stage === 'string'
        )
      ) {
        throw new Error(
          `chapter_queue.json chapter at index ${index} has an invalid lifecycle shape.`
        );
      }
      return {
        chapterNumber: chapter.chapterNumber,
        completedStages: chapter.completedStages,
        currentStage: chapter.currentStage,
        status: chapter.status
      };
    })
  };
}

function fakeOutputPath(
  root: string,
  index: number,
  schemaName?: string
): string {
  return path.join(
    root,
    `novel-loop-codex-output-negative-${index}`,
    schemaName === undefined ? 'final_output.md' : 'final_output.json'
  );
}

function fakeExecArguments(
  outputPath: string,
  schemaName?: string
): string[] {
  return [
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
    ...(schemaName === undefined
      ? []
      : [
          '--output-schema',
          path.join(
            repositoryRoot,
            'schemas',
            'codex-output',
            'slim',
            schemaName
          )
        ]),
    '-'
  ];
}

async function listProtectedArtifacts(projectRoot: string): Promise<string[]> {
  const files = await listFilesRecursively(projectRoot);
  return files.filter((relativePath) => {
    const normalized = relativePath.split(path.sep).join('/');
    if (normalized.startsWith('runs/') || normalized.startsWith('codex/')) {
      return false;
    }
    if (
      normalized.startsWith('snapshots/')
      || normalized.startsWith('diffs/')
    ) {
      return true;
    }
    const fileName = path.posix.basename(normalized);
    return /(?:approval|preview|state_diff|snapshot|commit|canon_patch|diagnostics|revision_plan|^final(?:_|\.))/i
      .test(fileName);
  }).sort();
}

async function listFilesRecursively(
  root: string,
  relativeRoot = ''
): Promise<string[]> {
  const directory = path.join(root, relativeRoot);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
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

async function writePlanningFakeCodex(root: string): Promise<{
  codexBin: string;
  errorLogPath: string;
}> {
  const codexBin = path.join(root, 'codex');
  const callsLogPath = path.join(root, 'planning-codex-calls.ndjson');
  const errorLogPath = path.join(root, 'planning-codex-errors.log');
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
const errorLogPath = ${JSON.stringify(errorLogPath)};
const statePath = ${JSON.stringify(statePath)};
const expectedProjectRoot = path.resolve(${JSON.stringify(expectedProjectRoot)});
const expectedSchemaRoot = path.resolve(${JSON.stringify(expectedSchemaRoot)});
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  fs.appendFileSync(errorLogPath, String(chunk));
  return originalStderrWrite(chunk, ...args);
};
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
const promptContracts = {
  'planning.generate_global_outline_text': {
    requiredMarkers: [
      'Write a concise global outline for the novel.',
      '- Return only markdown.',
      '- Keep it compact enough for downstream planning.'
    ],
    requiredBlocks: [
      'brief_summary',
      'story_bible_summary',
      'genre_contract_summary'
    ]
  },
  'planning.generate_volume_outline_text': {
    requiredMarkers: [
      'Write a concise volume 1 outline.',
      '- Return only markdown.',
      '- Keep the outline focused on the first three chapters.'
    ],
    requiredBlocks: [
      'global_outline_summary',
      'story_bible_summary'
    ]
  },
  'planning.generate_arc_map_minimal_json': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Create a minimal arc map.',
      'Each arc needs id, name, type, and summary.'
    ],
    requiredBlocks: [
      'global_outline_summary',
      'volume_outline_summary'
    ]
  },
  'planning.generate_chapter_queue_minimal_json': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Create a minimal chapter queue for the first three chapters.',
      'Each chapter needs title, summary, primaryFunction, and targetDebts.'
    ],
    requiredBlocks: [
      'global_outline_summary',
      'volume_outline_summary'
    ]
  },
  'planning.plan_chapter_mission_slim': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Create a minimal chapter mission.',
      'Use exactly these top-level keys:',
      'Do not invent undeclared debt or character IDs.'
    ],
    requiredBlocks: [
      'chapter_number',
      'story_state_summary',
      'chapter_queue_ITEM'
    ]
  },
  'planning.generate_plan_candidates_slim': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Generate minimal plan candidates for the chapter.',
      'Produce exactly 3 candidates.'
    ],
    requiredBlocks: [
      'chapter_number',
      'mission_summary'
    ]
  },
  'planning.rank_plan_candidates_slim': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Select the strongest candidate plan.',
      'must match one candidate id.'
    ],
    requiredBlocks: [
      'chapter_number',
      'candidate_ids',
      'plan_candidates'
    ]
  },
  'planning.generate_scene_cards_slim': {
    requiredMarkers: [
      'Return only JSON that matches the provided output schema.',
      'Create two concise scene cards for the selected chapter plan.',
      'Include a non-empty characters array for every scene.',
      'characters may contain only IDs from character_id_name_map.',
      'character_id_name_map includes committed Story State characters and any provisional characters explicitly declared by the Chapter Mission.',
      'Do not invent character IDs beyond the supplied map.',
      'Never use a display name in characters.'
    ],
    requiredBlocks: [
      'chapter_number',
      'mission_summary',
      'selected_plan_summary',
      'character_id_name_map',
      'mission_character_refs'
    ]
  },
  'production.write_scene': {
    requiredMarkers: [
      'Write this scene as concise prose.',
      '- Return only markdown prose.',
      '- Do not modify files.'
    ],
    requiredBlocks: [
      'scene_card_json',
      'style_summary'
    ]
  }
};
const forbiddenPromptMarkers = [
  'workspace-write',
  'danger-full-access',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  'mutate story state',
  'modify story state',
  'write story state',
  'overwrite story state',
  'update story state',
  'write final.md',
  'create final.md',
  'generate final.md',
  'write final chapter',
  'generate final chapter',
  'write canon patch',
  'generate canon patch',
  'apply canon patch',
  'write canon_patch',
  'generate canon_patch',
  'apply canon_patch',
  'commit the chapter',
  'commit chapter',
  'submit the chapter',
  'run shell command',
  'execute shell command',
  'invoke shell command',
  'switch provider',
  'select provider',
  'use provider'
];
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
if (outputPath === expectedProjectRoot || outputPath.startsWith(expectedProjectRoot + path.sep)) {
  process.stderr.write('Codex output path must not be inside the project');
  process.exit(2);
}
const expectedOutputName = schemaName === undefined ? 'final_output.md' : 'final_output.json';
if (
  !path.basename(path.dirname(outputPath)).startsWith('novel-loop-codex-output-')
  || path.basename(outputPath) !== expectedOutputName
) {
  process.stderr.write('Unexpected Codex output artifact path');
  process.exit(2);
}
assertPromptContract(promptId, stdin);
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
    charactersToIntroduce: [{
      characterId: 'char_lincheng',
      name: 'Lin Cheng',
      role: 'protagonist'
    }],
    characterDeltas: [{
      characterId: 'char_lincheng',
      from: 'skeptical',
      to: 'alert',
      evidenceRequired: 'He hears the broadcast without a power source.'
    }],
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
        characters: ['char_lincheng']
      },
      {
        purpose: 'Turn the broadcast into a decision.',
        conflict: 'Lin Cheng must choose whether to ignore the warning.',
        entryPoint: 'The address repeats after the room falls silent.',
        exitPoint: 'Lin Cheng writes down the address and leaves.',
        location: 'Apartment stairwell',
        characters: ['char_lincheng']
      }
    ]
  })
};
const expectedSceneId = promptId === 'production.write_scene'
  ? 'scene_' + String(
      completedPromptIds.filter((item) => item === 'production.write_scene').length + 1
    ).padStart(3, '0')
  : null;
if (expectedSceneId !== null) {
  const rawSceneCard = readPromptBlock(stdin, 'scene_card_json');
  let sceneCard;
  try {
    sceneCard = JSON.parse(rawSceneCard || '');
  } catch {
    failPromptContract('invalid scene card JSON');
  }
  const expectedSceneOrder = Number(expectedSceneId.slice(-3));
  const sceneCardIsValid = (
    sceneCard !== null
    && typeof sceneCard === 'object'
    && sceneCard.sceneId === expectedSceneId
    && sceneCard.chapterNumber === 1
    && sceneCard.order === expectedSceneOrder
    && hasNonEmptyString(sceneCard.purpose)
    && hasNonEmptyString(sceneCard.conflict)
    && hasNonEmptyString(sceneCard.entryPoint)
    && hasNonEmptyString(sceneCard.exitPoint)
    && hasNonEmptyString(sceneCard.location)
    && Array.isArray(sceneCard.characters)
    && sceneCard.characters.length > 0
    && sceneCard.characters.every(hasNonEmptyString)
  );
  if (!sceneCardIsValid) {
    failPromptContract('invalid scene card context');
  }
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

function assertPromptContract(id, prompt) {
  const normalizedPrompt = prompt.toLowerCase();
  const instructionSurface = normalizedPrompt
    .replaceAll('do not modify files', '')
    .replaceAll('do not run shell commands', '')
    .replaceAll('do not commit story state', '');
  if (forbiddenPromptMarkers.some((marker) => instructionSurface.includes(marker))) {
    process.stderr.write('Forbidden instruction in fake Codex prompt');
    process.exit(2);
  }
  const contract = promptContracts[id];
  if (contract === undefined) {
    failPromptContract('missing prompt contract');
  }
  for (const marker of contract.requiredMarkers) {
    if (!prompt.includes(marker)) {
      failPromptContract('missing required marker');
    }
  }
  for (const blockName of contract.requiredBlocks) {
    const block = readPromptBlock(prompt, blockName);
    if (block === null || block.trim().length === 0) {
      failPromptContract('missing required context block');
    }
  }
  if (
    id === 'planning.plan_chapter_mission_slim'
    || id === 'planning.generate_plan_candidates_slim'
    || id === 'planning.rank_plan_candidates_slim'
    || id === 'planning.generate_scene_cards_slim'
  ) {
    if (readPromptBlock(prompt, 'chapter_number')?.trim() !== '1') {
      failPromptContract('unexpected chapter number');
    }
  }
  if (
    id === 'planning.rank_plan_candidates_slim'
    && readPromptBlock(prompt, 'candidate_ids')?.trim()
      !== 'plan_001, plan_002, plan_003'
  ) {
    failPromptContract('unexpected candidate IDs');
  }
}

function readPromptBlock(prompt, blockName) {
  const opening = '<' + blockName + '>';
  const closing = '</' + blockName + '>';
  const start = prompt.indexOf(opening);
  if (start === -1) {
    return null;
  }
  const contentStart = start + opening.length;
  const end = prompt.indexOf(closing, contentStart);
  return end === -1 ? null : prompt.slice(contentStart, end);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function failPromptContract(reason) {
  process.stderr.write('Prompt contract violation for ' + promptId + ': ' + reason);
  process.exit(2);
}
`;
  await writeFile(codexBin, script, { mode: 0o700 });
  await chmod(codexBin, 0o700);
  return { codexBin, errorLogPath };
}
