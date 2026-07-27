import { describe, expect, test } from 'vitest';

import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type { SystemReadiness } from '../../src/shared/systemContract';
import { registerSystemHandlers } from '../../src/main/ipc/registerSystemHandlers';
import type { SystemReadinessService } from '../../src/main/services/SystemReadinessService';

const readyResponse: SystemReadiness = {
  app: {
    name: 'Novel Loop',
    platform: 'linux',
    version: '0.1.0'
  },
  checkedAt: '2026-07-27T01:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '本地 Codex 已准备好。',
    version: 'codex-cli 1.2.3'
  }
};

interface CapturedHandler {
  (
    event: { senderFrame: { url: string } },
    request: unknown
  ): Promise<SystemReadiness>;
}

function register(service: SystemReadinessService) {
  let channel = '';
  let handler: CapturedHandler | undefined;
  const registrar = {
    handle(
      registeredChannel: string,
      registeredHandler: CapturedHandler
    ) {
      channel = registeredChannel;
      handler = registeredHandler;
    }
  };

  registerSystemHandlers(
    registrar,
    service,
    'http://127.0.0.1:5173'
  );

  if (!handler) {
    throw new Error('Expected readiness handler to be registered.');
  }

  return { channel, handler };
}

describe('system readiness IPC handler', () => {
  test('registers one named channel and returns schema-valid redacted data', async () => {
    const service: SystemReadinessService = {
      getReadiness: async () => readyResponse
    };
    const { channel, handler } = register(service);

    const result = await handler(
      { senderFrame: { url: 'http://127.0.0.1:5173/setup' } },
      {}
    );

    expect(channel).toBe(IPC_CHANNELS.systemGetReadiness);
    expect(result).toEqual(readyResponse);
    expect(JSON.stringify(result)).not.toMatch(
      /binaryPath|doctorJson|token|auth|rawOutput|command|runId|environment/i
    );
  });

  test('rejects a request containing unrecognized input', async () => {
    const { handler } = register({
      getReadiness: async () => readyResponse
    });

    await expect(handler(
      { senderFrame: { url: 'http://127.0.0.1:5173/setup' } },
      { channel: 'arbitrary' }
    )).rejects.toThrow();
  });

  test('rejects an untrusted sender before calling the service', async () => {
    let called = false;
    const { handler } = register({
      getReadiness: async () => {
        called = true;
        return readyResponse;
      }
    });

    await expect(handler(
      { senderFrame: { url: 'https://example.com' } },
      {}
    )).rejects.toThrow('Untrusted renderer request.');
    expect(called).toBe(false);
  });

  test('rejects service output that violates the response schema', async () => {
    const { handler } = register({
      getReadiness: async () => ({
        ...readyResponse,
        codex: {
          ...readyResponse.codex,
          binaryPath: '/home/author/.local/bin/codex'
        }
      })
    });

    await expect(handler(
      { senderFrame: { url: 'http://127.0.0.1:5173/setup' } },
      {}
    )).rejects.toThrow();
  });

  test('rejects a semantically contradictory readiness response', async () => {
    const { handler } = register({
      getReadiness: async () => ({
        ...readyResponse,
        codex: {
          ...readyResponse.codex,
          canRunSmoke: false
        }
      } as unknown as SystemReadiness)
    });

    await expect(handler(
      { senderFrame: { url: 'http://127.0.0.1:5173/setup' } },
      {}
    )).rejects.toThrow();
  });
});
