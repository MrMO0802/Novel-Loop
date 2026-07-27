import type {
  DesktopSystemReadiness
} from 'novel-loop-engine/desktop';

import {
  SystemReadinessSchema,
  type SupportedDesktopPlatform,
  type SystemReadiness
} from '../../shared/systemContract';
import type { SystemReadinessService } from './SystemReadinessService';

export type EngineReadinessReader = () => Promise<DesktopSystemReadiness>;

export class EngineSystemReadinessService
implements SystemReadinessService {
  constructor(
    private readonly appVersion: string,
    private readonly platform: SupportedDesktopPlatform,
    private readonly readEngineReadiness: EngineReadinessReader =
      defaultEngineReadinessReader
  ) {}

  async getReadiness(): Promise<SystemReadiness> {
    const engineReadiness = await this.readEngineReadiness();

    return SystemReadinessSchema.parse({
      app: {
        name: 'Novel Loop',
        platform: this.platform,
        version: this.appVersion
      },
      checkedAt: engineReadiness.checkedAt,
      codex: engineReadiness.codex
    });
  }
}

async function defaultEngineReadinessReader(): Promise<DesktopSystemReadiness> {
  const { getDesktopSystemReadiness } = await import(
    'novel-loop-engine/desktop'
  );
  return getDesktopSystemReadiness();
}
