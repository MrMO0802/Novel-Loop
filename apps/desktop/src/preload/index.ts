import { contextBridge, ipcRenderer } from 'electron';

import type { NovelLoopDesktopApi } from '../shared/desktopApi';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  CreateProjectRequest,
  LibraryLocationSelection,
  ProjectLibraryResult,
  ProjectOpenResult
} from '../shared/projectContract';
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
  },
  projects: {
    list: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsList,
        {}
      );
      return response as ProjectLibraryResult;
    },
    chooseDefaultLibrary: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsChooseDefaultLibrary,
        {}
      );
      return response as LibraryLocationSelection;
    },
    create: async (request: CreateProjectRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsCreate,
        request
      );
      return response as ProjectOpenResult;
    },
    openExisting: async () => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsOpenExisting,
        {}
      );
      return response as ProjectOpenResult;
    },
    open: async (projectKey: string) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsOpen,
        { projectKey }
      );
      return response as ProjectOpenResult;
    },
    remove: async (projectKey: string) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.projectsRemove,
        { projectKey }
      );
      return response as ProjectLibraryResult;
    }
  }
};

contextBridge.exposeInMainWorld('novelLoop', novelLoopApi);
