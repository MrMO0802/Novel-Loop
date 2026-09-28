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
  ChapterAdoptDraftRevisionRequest,
  ChapterAdjustMissionRequest,
  ChapterAdjustPlanRequest,
  ChapterAuthoringResult,
  ChapterCancelRequest,
  ChapterDraftReviewResult,
  ChapterDraftAdoptionResult,
  ChapterDraftWorkingCopyResult,
  ChapterDraftWorkingCopySaveResult,
  ChapterDiscardDraftWorkingCopyRequest,
  ChapterDiscardDraftWorkingCopyResult,
  ChapterGetRequest,
  ChapterInspectRequest,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterReadDraftRequest,
  ChapterReadDraftWorkingCopyRequest,
  ChapterReadPlanRequest,
  ChapterSaveMissionWorkingCopyRequest,
  ChapterSaveDraftWorkingCopyRequest,
  ChapterSavePlanWorkingCopyRequest,
  ChapterSelectDirectionRequest,
  ChapterStartDraftingRequest,
  ChapterStartPlanningRequest,
  ChapterTask
} from './chapterContract';
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
} from './submissionContract';

export interface NovelLoopDesktopApi {
  diagnosticRevision: import('./diagnosticRevisionContract').DiagnosticRevisionApi;
  submission: {
    startCheck(request: SubmissionStartCheckRequest): Promise<SubmissionStartCheckResult>;
    get(request: SubmissionGetRequest): Promise<SubmissionTask>;
    cancel(request: SubmissionCancelRequest): Promise<SubmissionTask>;
    readPreview(request: SubmissionReadPreviewRequest): Promise<SubmissionPreviewResult>;
    confirm(request: SubmissionConfirmRequest): Promise<SubmissionConfirmResult>;
  };
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
    readDraftWorkingCopy(request: ChapterReadDraftWorkingCopyRequest): Promise<ChapterDraftWorkingCopyResult>;
    saveDraftWorkingCopy(request: ChapterSaveDraftWorkingCopyRequest): Promise<ChapterDraftWorkingCopySaveResult>;
    discardDraftWorkingCopy(request: ChapterDiscardDraftWorkingCopyRequest): Promise<ChapterDiscardDraftWorkingCopyResult>;
    adoptDraftRevision(request: ChapterAdoptDraftRevisionRequest): Promise<ChapterDraftAdoptionResult>;
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
