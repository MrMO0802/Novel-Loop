import { describe, expect, test } from 'vitest';

import { EngineSystemReadinessService } from '../../src/main/services/EngineSystemReadinessService';
import { SystemReadinessSchema } from '../../src/shared/systemContract';

describe('EngineSystemReadinessService', () => {
  test('adds desktop app metadata to the redacted engine result', async () => {
    const service = new EngineSystemReadinessService(
      '0.1.0',
      'linux',
      async () => ({
        checkedAt: '2026-07-27T02:00:00.000Z',
        codex: {
          canRunSmoke: true,
          status: 'ready',
          summary: '本地 Codex 已准备好。',
          version: 'codex-cli 1.2.3'
        }
      })
    );

    const result = await service.getReadiness();

    expect(SystemReadinessSchema.parse(result)).toEqual({
      app: {
        name: 'Novel Loop',
        platform: 'linux',
        version: '0.1.0'
      },
      checkedAt: '2026-07-27T02:00:00.000Z',
      codex: {
        canRunSmoke: true,
        status: 'ready',
        summary: '本地 Codex 已准备好。',
        version: 'codex-cli 1.2.3'
      }
    });
  });
});
