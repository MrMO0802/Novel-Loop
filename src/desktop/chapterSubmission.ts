export type { SubmissionProjectInput } from '../app/desktopSubmissionSource.js';
export { readDesktopSubmissionDiagnostics } from '../app/desktopSubmissionDiagnostics.js';
export type { SubmissionDiagnosticsInput, DesktopSubmissionDiagnostics } from '../app/desktopSubmissionDiagnostics.js';
import { confirmSubmissionCommit, type SubmissionConfirmInput, type SubmissionConfirmResult } from '../app/desktopSubmissionCommit.js';
export type { SubmissionConfirmInput, SubmissionConfirmResult } from '../app/desktopSubmissionCommit.js';
export { readDesktopSubmissionTasks, readDesktopSubmissionRecovery } from '../app/desktopSubmissionRecovery.js';
export type { SubmissionReadInput, DesktopSubmissionRecoveryResult } from '../app/desktopSubmissionRecovery.js';

export async function confirmDesktopChapterSubmission(input: SubmissionConfirmInput): Promise<SubmissionConfirmResult> {
  return confirmSubmissionCommit(input);
}
export type { SubmissionCheckInput, SubmissionCheckOptions, DesktopSubmissionVerifiedPreview } from '../app/desktopSubmissionPreview.js';
export type { DesktopSubmissionPreview, DesktopSubmissionSource, DesktopSubmissionTask } from '../schemas/desktopSubmission.js';
export {
  checkSubmissionPreview as checkDesktopChapterSubmission,
  readSubmissionPreview as readDesktopSubmissionPreview,
  verifyDesktopSubmissionPreviewIntegrity
} from '../app/desktopSubmissionPreview.js';
