import { contextBridge, ipcRenderer } from 'electron';

import type { NovelLoopDesktopApi } from '../shared/desktopApi';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  FoundationCancelRequest,
  FoundationGetRequest,
  FoundationReadRequest,
  FoundationReviewResult,
  FoundationStartRequest,
  FoundationTask
} from '../shared/foundationContract';
import type {
  PlanningCancelRequest,
  PlanningGetRequest,
  PlanningReadRequest,
  PlanningReviewResult,
  PlanningStartRequest,
  PlanningTask
} from '../shared/planningContract';
import type {
  ChapterAdoptRevisionRequest,
  ChapterAdjustMissionRequest,
  ChapterAdjustPlanRequest,
  ChapterAuthoringResult,
  ChapterCancelRequest,
  ChapterDraftReviewResult,
  ChapterDraftWorkingCopyResult,
  ChapterDraftWorkingCopySaveResult,
  ChapterDiscardDraftWorkingCopyResult,
  ChapterDraftAdoptionResult,
  ChapterGetRequest,
  ChapterInspectRequest,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterReadDraftRequest,
  ChapterReadDraftWorkingCopyRequest,
  ChapterReadPlanRequest,
  ChapterSaveMissionWorkingCopyRequest,
  ChapterSaveDraftWorkingCopyRequest,
  ChapterDiscardDraftWorkingCopyRequest,
  ChapterAdoptDraftRevisionRequest,
  ChapterSavePlanWorkingCopyRequest,
  ChapterSelectDirectionRequest,
  ChapterStartDraftingRequest,
  ChapterStartPlanningRequest,
  ChapterTask
} from '../shared/chapterContract';
import type {
  CreateProjectRequest,
  LibraryLocationSelection,
  ProjectLibraryResult,
  ProjectOpenResult
} from '../shared/projectContract';
import type { SystemReadiness } from '../shared/systemContract';
import type {
  SubmissionCancelRequest,
  SubmissionConfirmRequest,
  SubmissionConfirmResult,
  SubmissionGetRequest,
  SubmissionPreviewResult,
  SubmissionReadPreviewRequest,
  SubmissionStartCheckRequest,
  SubmissionStartCheckResult,
  SubmissionTask
} from '../shared/submissionContract';

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
  },
  foundation: {
    start: async (request: FoundationStartRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.foundationStart,
        request
      );
      return response as FoundationTask;
    },
    get: async (request: FoundationGetRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.foundationGet,
        request
      );
      return response as FoundationTask;
    },
    cancel: async (request: FoundationCancelRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.foundationCancel,
        request
      );
      return response as FoundationTask;
    },
    read: async (request: FoundationReadRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.foundationRead,
        request
      );
      return response as FoundationReviewResult;
    }
  },
  planning: {
    start: async (request: PlanningStartRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.planningStart,
        request
      );
      return response as PlanningTask;
    },
    get: async (request: PlanningGetRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.planningGet,
        request
      );
      return response as PlanningTask;
    },
    cancel: async (request: PlanningCancelRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.planningCancel,
        request
      );
      return response as PlanningTask;
    },
    read: async (request: PlanningReadRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.planningRead,
        request
      );
      return response as PlanningReviewResult;
    }
  },
  chapter: {
    inspect: async (request: ChapterInspectRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterInspect,
        request
      );
      return response as ChapterInspection;
    },
    startPlanning: async (request: ChapterStartPlanningRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterStartPlanning,
        request
      );
      return response as ChapterTask;
    },
    startDrafting: async (request: ChapterStartDraftingRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterStartDrafting,
        request
      );
      return response as ChapterTask;
    },
    adjustMission: async (request: ChapterAdjustMissionRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterAdjustMission,
        request
      );
      return response as ChapterTask;
    },
    adjustPlan: async (request: ChapterAdjustPlanRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterAdjustPlan,
        request
      );
      return response as ChapterTask;
    },
    get: async (request: ChapterGetRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterGet,
        request
      );
      return response as ChapterTask;
    },
    cancel: async (request: ChapterCancelRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterCancel,
        request
      );
      return response as ChapterTask;
    },
    readPlan: async (request: ChapterReadPlanRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterReadPlan,
        request
      );
      return response as ChapterPlanReviewResult;
    },
    readDraft: async (request: ChapterReadDraftRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterReadDraft,
        request
      );
      return response as ChapterDraftReviewResult;
    },
    readDraftWorkingCopy: async (request: ChapterReadDraftWorkingCopyRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.chapterReadDraftWorkingCopy, request);
      return response as ChapterDraftWorkingCopyResult;
    },
    saveDraftWorkingCopy: async (request: ChapterSaveDraftWorkingCopyRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.chapterSaveDraftWorkingCopy, request);
      return response as ChapterDraftWorkingCopySaveResult;
    },
    discardDraftWorkingCopy: async (request: ChapterDiscardDraftWorkingCopyRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.chapterDiscardDraftWorkingCopy, request);
      return response as ChapterDiscardDraftWorkingCopyResult;
    },
    adoptDraftRevision: async (request: ChapterAdoptDraftRevisionRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.chapterAdoptDraftRevision, request);
      return response as ChapterDraftAdoptionResult;
    },
    selectDirection: async (request: ChapterSelectDirectionRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterSelectDirection,
        request
      );
      return response as ChapterAuthoringResult;
    },
    saveMissionWorkingCopy: async (
      request: ChapterSaveMissionWorkingCopyRequest
    ) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterSaveMissionWorkingCopy,
        request
      );
      return response as ChapterAuthoringResult;
    },
    savePlanWorkingCopy: async (
      request: ChapterSavePlanWorkingCopyRequest
    ) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterSavePlanWorkingCopy,
        request
      );
      return response as ChapterAuthoringResult;
    },
    adoptRevision: async (request: ChapterAdoptRevisionRequest) => {
      const response: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.chapterAdoptRevision,
        request
      );
      return response as ChapterAuthoringResult;
    }
  },
  submission: {
    startCheck: async (request: SubmissionStartCheckRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.submissionStartCheck, request);
      return response as SubmissionStartCheckResult;
    },
    get: async (request: SubmissionGetRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.submissionGet, request);
      return response as SubmissionTask;
    },
    cancel: async (request: SubmissionCancelRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.submissionCancel, request);
      return response as SubmissionTask;
    },
    readPreview: async (request: SubmissionReadPreviewRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.submissionReadPreview, request);
      return response as SubmissionPreviewResult;
    },
    confirm: async (request: SubmissionConfirmRequest) => {
      const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.submissionConfirm, request);
      return response as SubmissionConfirmResult;
    }
  }
};

contextBridge.exposeInMainWorld('novelLoop', novelLoopApi);
