import { AppError, getErrorMessage } from '../utils/AppError.js';

export function formatCliError(error: unknown): string {
  if (error instanceof AppError) {
    if (error.details !== undefined) {
      const lines = [`ERROR ${error.code}:`, `errorCode: ${error.code}`, `message: ${error.message}`];
      if (error.details.chapterNumber !== undefined) {
        lines.push(`chapterNumber: ${error.details.chapterNumber}`);
      }
      if (error.details.stage !== undefined) {
        lines.push(`stage: ${error.details.stage}`);
      }
      if (error.details.conflictCount !== undefined) {
        lines.push(`conflictCount: ${error.details.conflictCount}`);
      }
      if (error.details.highestSeverity !== undefined) {
        lines.push(`highestSeverity: ${error.details.highestSeverity}`);
      }
      if (error.details.conflictReportPath !== undefined) {
        lines.push(`conflictReportPath: ${error.details.conflictReportPath}`);
      }
      if (error.details.repairableCount !== undefined) {
        lines.push(`repairableCount: ${error.details.repairableCount}`);
      }
      if (error.details.unrepairableCount !== undefined) {
        lines.push(`unrepairableCount: ${error.details.unrepairableCount}`);
      }
      if (error.details.reason !== undefined) {
        lines.push(`reason: ${error.details.reason}`);
      }
      if (error.details.suggestedNextCommand !== undefined) {
        lines.push(`suggestedNextCommand: ${error.details.suggestedNextCommand}`);
      }
      return lines.join('\n');
    }

    return `ERROR ${error.code}: ${error.message}`;
  }

  return `ERROR UNEXPECTED: ${getErrorMessage(error)}`;
}

export function getCliExitCode(error: unknown): number {
  return error instanceof AppError ? error.exitCode : 1;
}
