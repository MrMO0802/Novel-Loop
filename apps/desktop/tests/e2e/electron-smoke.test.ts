import { _electron as electron, expect, test } from '@playwright/test';
import { statSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const electronExecutable = require('electron') as string;
const desktopRoot = path.resolve(__dirname, '../..');

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
        projectLibrary: await window.novelLoop.projects.list(),
        projectKeys: Object.keys(window.novelLoop.projects),
        systemKeys: Object.keys(window.novelLoop.system)
      }));

      expect(boundary).toEqual({
        apiKeys: ['system', 'projects'],
        hasReadinessMethod: true,
        nodeProcessType: 'undefined',
        nodeRequireType: 'undefined',
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
