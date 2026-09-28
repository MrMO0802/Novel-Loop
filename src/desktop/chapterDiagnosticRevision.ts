export { generateDiagnosticRevision, readDiagnosticRevisionCandidate, readDiagnosticRevisionTask, listDiagnosticRevisionTasks, cancelDiagnosticRevision } from '../app/desktopDiagnosticRevision.js';
export type { DiagnosticRevisionIdentity, DiagnosticRevisionTaskInput, DiagnosticRevisionRunOptions } from '../app/desktopDiagnosticRevision.js';
export { adoptDiagnosticRevision, rejectDiagnosticRevision } from '../app/desktopDiagnosticRevisionAdoption.js';
export { recoverInterruptedDiagnosticRevisionTask } from '../app/desktopDiagnosticRevision.js';
export { captureDiagnosticRevisionSource } from '../app/desktopDiagnosticRevisionSource.js';
export type { DiagnosticRevisionTask } from '../schemas/desktopDiagnosticRevision.js';
