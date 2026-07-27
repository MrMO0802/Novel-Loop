import { contextBridge, ipcRenderer } from 'electron';

import type { NovelLoopDesktopApi } from '../shared/desktopApi';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { SystemReadiness } from '../shared/systemContract';

const novelLoopApi: NovelLoopDesktopApi = {
  system: {
    getReadiness: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.systemGetReadiness,
        {}
      );
      return response as SystemReadiness;
    }
  }
};

contextBridge.exposeInMainWorld('novelLoop', novelLoopApi);
