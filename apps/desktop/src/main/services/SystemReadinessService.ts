import {
  SystemReadinessSchema,
  type SupportedDesktopPlatform,
  type SystemReadiness
} from '../../shared/systemContract';

export interface SystemReadinessService {
  getReadiness(): Promise<SystemReadiness>;
}

export class BootstrapSystemReadinessService
implements SystemReadinessService {
  constructor(
    private readonly appVersion: string,
    private readonly platform: SupportedDesktopPlatform
  ) {}

  async getReadiness(): Promise<SystemReadiness> {
    return SystemReadinessSchema.parse({
      app: {
        name: 'Novel Loop',
        platform: this.platform,
        version: this.appVersion
      },
      checkedAt: new Date().toISOString(),
      codex: {
        canRunSmoke: false,
        status: 'unavailable',
        summary: '本地创作环境检测服务尚未连接。',
        version: null
      }
    });
  }
}
