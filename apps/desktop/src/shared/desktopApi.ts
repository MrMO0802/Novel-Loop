import type {
  CreateProjectRequest,
  LibraryLocationSelection,
  ProjectLibraryResult,
  ProjectOpenResult
} from './projectContract';
import type { SystemReadiness } from './systemContract';
import type {
  FoundationCancelRequest,
  FoundationGetRequest,
  FoundationReadRequest,
  FoundationReviewResult,
  FoundationStartRequest,
  FoundationTask
} from './foundationContract';
import type {
  PlanningCancelRequest,
  PlanningGetRequest,
  PlanningReadRequest,
  PlanningReviewResult,
  PlanningStartRequest,
  PlanningTask
} from './planningContract';
import type {
  ChapterAdoptRevisionRequest,
  ChapterAdjustMissionRequest,
  ChapterAdjustPlanRequest,
  ChapterAuthoringResult,
  ChapterCancelRequest,
  ChapterDraftReviewResult,
  ChapterGetRequest,
  ChapterInspectRequest,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterReadDraftRequest,
  ChapterReadPlanRequest,
  ChapterSaveMissionWorkingCopyRequest,
  ChapterSavePlanWorkingCopyRequest,
  ChapterSelectDirectionRequest,
  ChapterStartDraftingRequest,
  ChapterStartPlanningRequest,
  ChapterTask
} from './chapterContract';

export interface NovelLoopDesktopApi {
  system: {
    getReadiness(): Promise<SystemReadiness>;
  };
  projects: {
    list(): Promise<ProjectLibraryResult>;
    chooseDefaultLibrary(): Promise<LibraryLocationSelection>;
    create(request: CreateProjectRequest): Promise<ProjectOpenResult>;
    openExisting(): Promise<ProjectOpenResult>;
    open(projectKey: string): Promise<ProjectOpenResult>;
    remove(projectKey: string): Promise<ProjectLibraryResult>;
  };
  foundation: {
    start(request: FoundationStartRequest): Promise<FoundationTask>;
    get(request: FoundationGetRequest): Promise<FoundationTask>;
    cancel(request: FoundationCancelRequest): Promise<FoundationTask>;
    read(request: FoundationReadRequest): Promise<FoundationReviewResult>;
  };
  planning: {
    start(request: PlanningStartRequest): Promise<PlanningTask>;
    get(request: PlanningGetRequest): Promise<PlanningTask>;
    cancel(request: PlanningCancelRequest): Promise<PlanningTask>;
    read(request: PlanningReadRequest): Promise<PlanningReviewResult>;
  };
  chapter: {
    inspect(request: ChapterInspectRequest): Promise<ChapterInspection>;
    startPlanning(request: ChapterStartPlanningRequest): Promise<ChapterTask>;
    startDrafting(request: ChapterStartDraftingRequest): Promise<ChapterTask>;
    adjustMission(request: ChapterAdjustMissionRequest): Promise<ChapterTask>;
    adjustPlan(request: ChapterAdjustPlanRequest): Promise<ChapterTask>;
    get(request: ChapterGetRequest): Promise<ChapterTask>;
    cancel(request: ChapterCancelRequest): Promise<ChapterTask>;
    readPlan(request: ChapterReadPlanRequest): Promise<ChapterPlanReviewResult>;
    readDraft(request: ChapterReadDraftRequest): Promise<ChapterDraftReviewResult>;
    selectDirection(
      request: ChapterSelectDirectionRequest
    ): Promise<ChapterAuthoringResult>;
    saveMissionWorkingCopy(
      request: ChapterSaveMissionWorkingCopyRequest
    ): Promise<ChapterAuthoringResult>;
    savePlanWorkingCopy(
      request: ChapterSavePlanWorkingCopyRequest
    ): Promise<ChapterAuthoringResult>;
    adoptRevision(
      request: ChapterAdoptRevisionRequest
    ): Promise<ChapterAuthoringResult>;
  };
}
