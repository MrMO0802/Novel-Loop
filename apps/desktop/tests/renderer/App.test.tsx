// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type {
  NovelLoopDesktopApi
} from '../../src/shared/desktopApi';
import type {
  SystemReadiness
} from '../../src/shared/systemContract';

const baseReadiness: SystemReadiness = {
  app: {
    name: 'Novel Loop',
    platform: 'linux',
    version: '0.1.0'
  },
  checkedAt: '2026-07-27T03:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '本地 Codex 已准备好。',
    version: 'codex-cli 1.2.3'
  }
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'novelLoop');
});

function installReadiness(
  response: SystemReadiness | Promise<SystemReadiness>
) {
  const getReadiness = vi.fn().mockImplementation(async () => response);
  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: {
      system: {
        getReadiness
      },
      projects: {
        list: vi.fn().mockResolvedValue({
          projects: [],
          defaultLocation: {
            configured: false,
            locationLabel: null
          },
          warning: null
        }),
        chooseDefaultLibrary: vi.fn(),
        create: vi.fn(),
        openExisting: vi.fn(),
        open: vi.fn(),
        remove: vi.fn()
      }
    } satisfies NovelLoopDesktopApi
  });
  return getReadiness;
}

describe('production first-launch readiness', () => {
  test('announces loading while the local check is running', () => {
    installReadiness(new Promise(() => {}));

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '正在检查本地创作环境'
    );
    expect(screen.getByRole('heading', {
      name: '正在确认这台电脑是否已经准备好'
    })).toBeVisible();
  });

  test('offers the project library when Codex is ready', async () => {
    installReadiness({
      ...baseReadiness,
      codex: {
        ...baseReadiness.codex,
        summary: 'CODEX_READY at /private/auth/token.json'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '本地创作环境已准备好'
    })).toBeVisible();
    expect(screen.getByText('codex-cli 1.2.3')).toBeVisible();
    expect(screen.getByRole('button', { name: '进入作品库' })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(
      /CODEX_READY|private|auth|token|json/i
    );
  });

  test('enters the real project library from readiness', async () => {
    installReadiness(baseReadiness);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', {
      name: '进入作品库'
    }));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: '作品库'
    })).toHaveFocus();
    expect(screen.getByRole('button', { name: '新建小说' })).toBeEnabled();
    expect(screen.getByRole('button', {
      name: '打开已有项目'
    })).toBeEnabled();
  });

  test.each([
    {
      action: '安装完成后重新检查',
      heading: '尚未检测到本地 Codex',
      status: 'not_installed' as const,
      summary: '尚未检测到本地 Codex。'
    },
    {
      action: '登录完成后重新检查',
      heading: 'Codex 尚未登录',
      status: 'not_logged_in' as const,
      summary: 'Codex 已安装，但尚未登录。'
    }
  ])('shows non-technical guidance for $status', async ({
    action,
    heading,
    status,
    summary
  }) => {
    installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: false,
        status,
        summary,
        version: status === 'not_installed' ? null : 'codex-cli 1.2.3'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(/--codex|auth|token|json/i);
  });

  test('keeps a usable doctor warning non-blocking', async () => {
    installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: true,
        status: 'warning',
        summary: 'Codex 可以使用，但环境检查返回了提醒。',
        version: 'codex-cli 1.2.3'
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: 'Codex 可以使用，但有一项提醒'
    })).toBeVisible();
    expect(screen.getByRole('button', { name: '仍然进入作品库' })).toBeEnabled();
  });

  test('recovers from an unavailable check by running it again', async () => {
    const getReadiness = installReadiness({
      ...baseReadiness,
      codex: {
        canRunSmoke: false,
        status: 'unavailable',
        summary: '暂时无法检查本地 Codex 状态。',
        version: null
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '暂时无法完成环境检查'
    })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));

    expect(getReadiness).toHaveBeenCalledTimes(2);
  });

  test('maps rejected preload calls to a safe message without leaking details', async () => {
    const getReadiness = vi.fn().mockRejectedValue(
      new Error('CODEX_EXEC_FAILED at /private/auth/token.json')
    );
    Object.defineProperty(window, 'novelLoop', {
      configurable: true,
      value: { system: { getReadiness } }
    });

    render(<App />);

    expect(await screen.findByRole('heading', {
      name: '暂时无法完成环境检查'
    })).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /CODEX_EXEC_FAILED|private|auth|token|json/i
    );
  });

  test('leaves an indefinitely pending check with a recoverable timeout state', async () => {
    vi.useFakeTimers();
    installReadiness(new Promise(() => {}));

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByRole('heading', {
      name: '环境检查用时比预期更长'
    })).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled();
  });
});
