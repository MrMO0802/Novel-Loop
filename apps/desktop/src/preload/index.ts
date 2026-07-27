import { contextBridge, ipcRenderer } from 'electron';

import type { NovelLoopDesktopApi } from '../shared/desktopApi';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { SystemReadinessSchema } from '../shared/systemContract';

const novelLoopApi: NovelLoopDesktopApi = {
  system: {
    getReadiness: async () => SystemReadinessSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.systemGetReadiness, {})
    )
  }
};

contextBridge.exposeInMainWorld('novelLoop', novelLoopApi);
