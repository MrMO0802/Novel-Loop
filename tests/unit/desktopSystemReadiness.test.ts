import { describe, expect, test } from 'vitest';

import type { CodexStatusResult } from '../../src/app/codexBoundary.js';
import { getDesktopSystemReadiness } from '../../src/desktop/systemReadiness.js';
import { AppError } from '../../src/utils/AppError.js';

const statusResult: CodexStatusResult = {
  binaryFound: true,
  binaryPath: '/home/author/.local/bin/codex',
  doctorJson: '{"token":"secret"}',
  healthOk: true,
  loginStatus: 'Logged in using ChatGPT',
  safety: {
    authFilesRead: false,
    sandbox: 'read-only',
    shellCommandsAllowed: false,
    storyStateCommitAllowed: false,
    workspaceWriteAllowed: false
  },
  sandbox: 'read-only',
  version: 'codex-cli 1.2.3'
};

describe('desktop system readiness mapping', () => {
  test('identifies a missing Codex platform dependency without leaking command output', async () => {
    const result = await getDesktopSystemReadiness({}, async () => {
      throw new AppError('CODEX_EXEC_FAILED',
        'Error: Missing optional dependency @openai/codex-linux-x64. /private/auth/token', 1);
    });
    expect(result.codex).toEqual({
      canRunSmoke: false,
      status: 'installation_incomplete',
      summary: 'Codex 安装不完整，无法启动。请修复安装后重新检查。',
      version: null
    });
    expect(JSON.stringify(result)).not.toMatch(/private|token|optional dependency/);
  });

  test('maps a healthy Codex status into a redacted author-facing result', async () => {
    const result = await getDesktopSystemReadiness(
      {},
      async () => statusResult
    );

    expect(result.codex).toEqual({
      canRunSmoke: true,
      status: 'ready',
      summary: '本地 Codex 已准备好。',
      version: 'codex-cli 1.2.3'
    });
    expect(JSON.stringify(result)).not.toMatch(
      /binaryPath|doctorJson|token|auth|rawOutput|command|runId|environment/i
    );
  });

  test('maps a missing binary without leaking the boundary error', async () => {
    const result = await getDesktopSystemReadiness(
      {},
      async () => {
        throw new AppError(
          'CODEX_BINARY_NOT_FOUND',
          'Codex missing at /private/path',
          2
        );
      }
    );

    expect(result.codex).toEqual({
      canRunSmoke: false,
      status: 'not_installed',
      summary: '尚未检测到本地 Codex。',
      version: null
    });
    expect(JSON.stringify(result)).not.toContain('/private/path');
  });

  test('distinguishes login-required from an unavailable health check', async () => {
    const notLoggedIn = await getDesktopSystemReadiness(
      {},
      async () => ({
        ...statusResult,
        healthOk: false,
        loginStatus: 'Not logged in'
      })
    );
    const unavailable = await getDesktopSystemReadiness(
      {},
      async () => {
        throw new Error('sensitive provider failure');
      }
    );

    expect(notLoggedIn.codex).toMatchObject({
      canRunSmoke: false,
      status: 'not_logged_in',
      summary: 'Codex 已安装，但尚未登录。'
    });
    expect(unavailable.codex).toEqual({
      canRunSmoke: false,
      status: 'unavailable',
      summary: '暂时无法检查本地 Codex 状态。',
      version: null
    });
    expect(JSON.stringify(unavailable)).not.toContain(
      'sensitive provider failure'
    );
  });

  test('keeps a doctor warning non-blocking for a logged-in Codex', async () => {
    const result = await getDesktopSystemReadiness(
      {},
      async () => ({
        ...statusResult,
        healthOk: false
      })
    );

    expect(result.codex).toEqual({
      canRunSmoke: true,
      status: 'warning',
      summary: 'Codex 可以使用，但环境检查返回了提醒。',
      version: 'codex-cli 1.2.3'
    });
  });
});
