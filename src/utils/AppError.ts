export interface AppErrorDetails {
  chapterNumber?: number;
  stage?: string;
  conflictCount?: number;
  highestSeverity?: string;
  conflictReportPath?: string;
  repairableCount?: number;
  unrepairableCount?: number;
  reason?: string;
  promptId?: string;
  normalizationErrorPath?: string;
  suggestedNextCommand?: string;
  sourceArtifactPath?: string;
  affectedMutationId?: string;
  storyStateMutated?: boolean;
  queueMutated?: boolean;
}

export class AppError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: AppErrorDetails | undefined;

  constructor(code: string, message: string, exitCode = 1, details?: AppErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
