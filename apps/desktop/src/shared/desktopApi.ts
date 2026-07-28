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
}
