import type { SystemReadiness } from './systemContract';

export interface NovelLoopDesktopApi {
  system: {
    getReadiness(): Promise<SystemReadiness>;
  };
}
