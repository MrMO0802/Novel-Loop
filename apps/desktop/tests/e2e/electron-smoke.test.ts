import { _electron as electron, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const electronExecutable = require('electron') as string;
const desktopRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const execFile = promisify(execFileCallback);

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
        foundationKeys: Object.keys(window.novelLoop.foundation),
        planningKeys: Object.keys(window.novelLoop.planning),
        projectKeys: Object.keys(window.novelLoop.projects),
        systemKeys: Object.keys(window.novelLoop.system)
      }));

      expect(boundary).toEqual({
        apiKeys: ['system', 'projects', 'foundation', 'planning'],
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

test('authors can complete global planning from Story Foundation without changing Story State', async () => {
  test.setTimeout(60_000);
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

      await expect(page.getByRole('heading', { name: '全局规划' })).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByRole('tab', { name: '全书方向' })).toBeVisible();
      await expect(page.getByText('Codex Global Outline')).toBeVisible();

      await page.getByRole('tab', { name: '第一卷' }).click();
      await expect(page.getByText('Codex Volume 01 Outline')).toBeVisible();
      await page.getByRole('tab', { name: '故事线' }).click();
      await expect(page.getByRole('heading', { name: 'Radio Signal' })).toBeVisible();
      await page.getByRole('tab', { name: '章节计划' }).click();
      await expect(page.getByText('第 1 章 The Radio Wakes')).toBeVisible();

      await page.getByRole('button', { name: '返回项目概览' }).click();
      const globalPlanStatus = page.locator('dt', { hasText: '全局规划' })
        .locator('xpath=following-sibling::dd');
      await expect(globalPlanStatus).toHaveText('已准备');
      await expect(page.getByRole('button', { name: '查看全局规划' })).toBeVisible();
    } finally {
      await application.close();
    }

    await expect(sha256(path.join(projectRoot, 'state', 'story_state.json')))
      .resolves.toBe(storyStateHashBefore);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

function electronEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
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
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in as fake-codex@example.com\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (!args.includes('exec')) {
  process.stderr.write('unknown fake codex command');
  process.exit(2);
}
const stdin = fs.readFileSync(0, 'utf8');
const promptId = (stdin.match(/PROMPT_ID:\\s*([^\\n]+)/) || [])[1] || 'unknown';
const outputIndex = args.indexOf('--output-last-message');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const outputs = {
  'planning.generate_global_outline_text': '# Codex Global Outline\\n\\nA three chapter opening arc around the radio signal.\\n',
  'planning.generate_volume_outline_text': '# Codex Volume 01 Outline\\n\\nThe radio mystery escalates through the first volume.\\n',
  'planning.generate_arc_map_minimal_json': JSON.stringify({ arcs: [{ id: 'arc_radio', name: 'Radio Signal', type: 'plot', summary: 'The signal pulls Lin Cheng toward the old building.' }] }),
  'planning.generate_chapter_queue_minimal_json': JSON.stringify({ chapters: [{ chapterNumber: 1, title: 'The Radio Wakes', summary: 'The radio speaks without power.', primaryFunction: 'Open the impossible broadcast.', targetDebts: [] }, { chapterNumber: 2, title: 'The Elevator Log', summary: 'The elevator records an impossible stop.', primaryFunction: 'Escalate the building mystery.', targetDebts: [] }, { chapterNumber: 3, title: 'The Missing Floor', summary: 'Lin Cheng finds signs of a hidden floor.', primaryFunction: 'Create a strong midpoint hook.', targetDebts: [] }] })
};
const finalText = outputs[promptId] || 'Codex text final\\n';
if (outputPath) fs.writeFileSync(outputPath, finalText);
process.stdout.write(JSON.stringify({ type: 'thread.started' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: finalText } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
`;
  await writeFile(codexBin, script, { mode: 0o700 });
  await chmod(codexBin, 0o700);
  return { codexBin };
}
