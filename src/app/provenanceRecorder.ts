import { RunLogger } from '../logging/RunLogger.js';
import type { ArtifactAction, RecordArtifactOptions } from '../logging/RunLogger.js';
import type { LLMCallRecord, RunError, StateMutationRecord } from '../schemas/index.js';
import type { RunContext } from './runContext.js';

export class ProvenanceRecorder {
  private readonly logger: RunLogger;

  constructor(private readonly context: RunContext) {
    this.logger = new RunLogger(context.paths, context.fileStore);
  }

  startRun(args: Record<string, unknown> = {}) {
    return this.logger.startRun({ runId: this.context.runId, command: this.context.command, args });
  }

  endRun(status: 'completed' | 'failed' | 'success' | 'partial' | 'blocked') {
    return this.logger.endRun(this.context.runId, status);
  }

  failRun(error: RunError) {
    return this.logger.recordError(this.context.runId, error).then(() => this.logger.endRun(this.context.runId, 'failed'));
  }

  recordPromptCall(call: LLMCallRecord) {
    return this.logger.recordLlmCall(this.context.runId, call);
  }

  recordGeneratedArtifact(path: string, options: Omit<RecordArtifactOptions, 'action'> = {}) {
    return this.logger.recordArtifact(this.context.runId, path, { ...options, action: 'generated' });
  }

  recordReusedArtifact(path: string, options: Omit<RecordArtifactOptions, 'action'> = {}) {
    return this.logger.recordArtifact(this.context.runId, path, { ...options, action: 'reused' });
  }

  recordArchivedArtifact(originalPath: string, archivedPath: string, archiveManifestPath: string) {
    return this.logger.recordArchivedArtifact(this.context.runId, originalPath, archivedPath, archiveManifestPath);
  }

  recordArtifact(path: string, action: ArtifactAction, options: Omit<RecordArtifactOptions, 'action'> = {}) {
    return this.logger.recordArtifact(this.context.runId, path, { ...options, action });
  }

  recordStateMutation(mutation: Omit<StateMutationRecord, 'mutationId'>) {
    return this.logger.recordStateMutation(this.context.runId, mutation);
  }

  recordError(error: RunError) {
    return this.logger.recordError(this.context.runId, error);
  }
}
