import type { NovelLoopDesktopApi } from '../../shared/desktopApi';

declare global {
  interface Window {
    novelLoop: NovelLoopDesktopApi;
  }
}

export {};
