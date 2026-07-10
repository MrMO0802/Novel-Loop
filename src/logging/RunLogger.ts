import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  RunEventSchema,
  RunManifestSchema,
  RunManifestV2Schema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ArtifactLineageRecord,
  LLMCallRecord,
  QueueTransitionRecord,
  RunError,
  RunEvent,
  RunEventType,
  RunResolvedContext,
  LegacyRunManifest,
  ReusePolicy,
  RunManifest,
  RunManifestV2,
  RunStatus,
  StateMutationRecord
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { readFileMetadata } from '../app/fileHash.js';

export interface RunLoggerOptions {
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export interface StartRunInput {
  runId: string;
  command: string;
  args?: Record<string, unknown>;
}

export type ArtifactAction = 'generated' | 'reused' | 'archived' | 'validated' | 'invalid' | 'skipped';

export interface RecordArtifactOptions {
  action?: ArtifactAction;
  sourcePaths?: string[];
  derivedFrom?: string[];
  archivedTo?: string;
  archiveManifestPath?: string;
  provenanceNote?: string;
  stage?: string;
}

export class RunLogger {
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;

  constructor(
    private readonly paths: ProjectPaths,
    private readonly fileStore = new FileStore(),
    options: RunLoggerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
  }

  async startRun(input: StartRunInput): Promise<RunManifestV2> {
    await this.fileStore.ensureDir(this.paths.runDir(input.runId));
    const startedAt = this.now().toISOString();
    const manifest: RunManifestV2 = RunManifestV2Schema.parse({
      schemaVersion: '2',
      runId: input.runId,
      projectId: this.paths.projectId,
      command: input.command,
      args: input.args ?? {},
      argv: buildArgv(input.command, input.args ?? {}),
      cwd: process.cwd(),
      status: 'running',
      startedAt,
      packageVersion: await this.readPackageVersion(),
      nodeVersion: process.version,
      provider: typeof input.args?.provider === 'string' ? input.args.provider : undefined,
      mockScenario: typeof input.args?.mockScenario === 'string' ? input.args.mockScenario : undefined,
      redactionPolicy: this.redactionPolicy(),
      resolvedContext: await this.buildResolvedContext(input.command, input.args ?? {}, 'before'),
      stages: [],
      promptCalls: [],
      llmCalls: [],
      artifacts: [],
      queueTransitions: [],
      stateMutations: [],
      snapshots: [],
      archives: [],
      conflicts: [],
      repairs: [],
      recommits: [],
      historicalRebases: [],
      reusePolicies: [],
      errors: [],
      auditRefs: [],
      summary: emptySummary()
    });
    await this.writeManifest(manifest);
    const startedChapterNumber = numberArg(input.args ?? {}, 'chapterNumber');
    await this.appendEvent(input.runId, 'RUN_STARTED', {
      payload: { command: input.command, args: input.args ?? {} },
      ...(startedChapterNumber === undefined ? {} : { chapterNumber: startedChapterNumber })
    });
    return manifest;
  }

  async recordArtifact(runId: string, artifactPath: string, options: RecordArtifactOptions | ArtifactAction = {}): Promise<RunManifestV2> {
    const normalizedOptions = typeof options === 'string' ? { action: options } : options;
    const manifest = await this.readManifestV2(runId);
    const action = normalizedOptions.action ?? 'generated';
    const classification = classifyArtifact(artifactPath);
    const existingIndex = manifest.artifacts.findIndex((artifact) => artifact.path === artifactPath && artifact.action === action);
    const absolutePath = this.paths.projectArtifact(artifactPath);
    const exists = await this.fileStore.exists(absolutePath);
    const metadata = exists ? await readFileMetadata(absolutePath, this.fileStore) : undefined;
    const artifact: ArtifactLineageRecord = {
      artifactId: artifactId(`${action}:${artifactPath}`),
      artifactType: classification.artifactType,
      path: artifactPath,
      ...(chapterNumberFromPath(artifactPath) === undefined ? {} : { chapterNumber: chapterNumberFromPath(artifactPath) }),
      phase: classification.phase,
      action,
      runId,
      stage: normalizedOptions.stage ?? stageFromPhase(classification.phase),
      ...(metadata === undefined ? {} : { sha256: metadata.sha256, sizeBytes: metadata.sizeBytes }),
      ...(classification.schemaName === undefined ? {} : { schemaName: classification.schemaName, schemaValid: exists }),
      sourceArtifactIds: (normalizedOptions.sourcePaths ?? (action === 'reused' ? [artifactPath] : [])).map((sourcePath) => artifactId(sourcePath)),
      sourcePaths: normalizedOptions.sourcePaths ?? (action === 'reused' ? [artifactPath] : []),
      derivedFrom: normalizedOptions.derivedFrom ?? [],
      ...(normalizedOptions.archivedTo === undefined ? {} : { archivedTo: normalizedOptions.archivedTo }),
      ...(normalizedOptions.archiveManifestPath === undefined ? {} : { archiveManifestPath: normalizedOptions.archiveManifestPath }),
      status: action === 'archived' || artifactPath.includes('/archive/') ? 'archived' : exists ? 'active' : 'missing',
      provenanceNote: normalizedOptions.provenanceNote ?? defaultProvenanceNote(action, runId)
    };
    const stageName = artifact.stage;
    const isNewStage = stageName !== undefined && !manifest.stages.some((stage) => stage.name === stageName);
    if (existingIndex === -1) {
      manifest.artifacts.push(artifact);
    } else {
      manifest.artifacts[existingIndex] = artifact;
    }
    ensureStage(manifest, stageName, artifact.chapterNumber, this.now().toISOString(), 'completed');
    updateSummary(manifest);
    await this.writeManifest(manifest);
    if (isNewStage && stageName !== undefined) {
      await this.appendEvent(runId, 'STAGE_STARTED', {
        stage: stageName,
        ...(artifact.chapterNumber === undefined ? {} : { chapterNumber: artifact.chapterNumber }),
        payload: { stage: stageName }
      });
      await this.appendEvent(runId, 'STAGE_COMPLETED', {
        stage: stageName,
        ...(artifact.chapterNumber === undefined ? {} : { chapterNumber: artifact.chapterNumber }),
        payload: { stage: stageName }
      });
    }
    await this.appendEvent(runId, eventForArtifactAction(action, exists), {
      ...(artifact.stage === undefined ? {} : { stage: artifact.stage }),
      ...(artifact.chapterNumber === undefined ? {} : { chapterNumber: artifact.chapterNumber }),
      relatedArtifactPaths: [artifactPath],
      payload: artifact
    });
    if (artifact.schemaValid === true) {
      await this.appendEvent(runId, 'ARTIFACT_VALIDATED', {
        ...(artifact.stage === undefined ? {} : { stage: artifact.stage }),
        ...(artifact.chapterNumber === undefined ? {} : { chapterNumber: artifact.chapterNumber }),
        relatedArtifactPaths: [artifactPath],
        payload: { path: artifactPath, schemaName: artifact.schemaName }
      });
    }
    return manifest;
  }

  async recordArchivedArtifact(
    runId: string,
    originalPath: string,
    archivedPath: string,
    archiveManifestPath: string,
    note = 'archived before stale regeneration'
  ): Promise<RunManifestV2> {
    return this.recordArtifact(runId, archivedPath, {
      action: 'archived',
      sourcePaths: [originalPath],
      archivedTo: archivedPath,
      archiveManifestPath,
      provenanceNote: note,
      stage: 'archive'
    });
  }

  async recordArchive(runId: string, archiveManifestPath: string, input: { chapterNumber?: number; count?: number; reason?: string }): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const archive = {
      archiveId: artifactId(archiveManifestPath),
      archiveManifestPath,
      ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
      archivedArtifactCount: input.count ?? 0,
      ...(input.reason === undefined ? {} : { reason: input.reason })
    };
    if (!manifest.archives.some((item) => item.archiveManifestPath === archiveManifestPath)) {
      manifest.archives.push(archive);
    }
    updateSummary(manifest);
    await this.writeManifest(manifest);
    return manifest;
  }

  async recordError(runId: string, error: RunError): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const errorWithTimestamp: RunError = {
      ...error,
      createdAt: error.createdAt ?? this.now().toISOString()
    };
    manifest.errors.push(errorWithTimestamp);
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, 'ERROR_RECORDED', {
      severity: 'error',
      payload: errorWithTimestamp
    });
    return manifest;
  }

  async recordLlmCall(runId: string, call: LLMCallRecord): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const promptCall: LLMCallRecord = {
      promptCallId: call.promptCallId ?? `prompt_${String(manifest.promptCalls.length + 1).padStart(3, '0')}_${call.promptId.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      ...call,
      redacted: call.redacted ?? false,
      jsonParsed: call.jsonParsed ?? false,
      retryCount: call.retryCount ?? 0,
      tokenUsage: call.tokenUsage ?? call.usage
    };
    manifest.promptCalls.push(promptCall);
    manifest.llmCalls.push(promptCall);
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, 'PROMPT_CALL_STARTED', {
      stage: 'prompt',
      payload: { promptCallId: promptCall.promptCallId, promptId: promptCall.promptId, startedAt: promptCall.startedAt }
    });
    await this.appendEvent(runId, call.status === 'failed' ? 'PROMPT_CALL_FAILED' : 'PROMPT_CALL_COMPLETED', {
      stage: 'prompt',
      severity: call.status === 'failed' ? 'error' : 'info',
      payload: promptCall
    });
    return manifest;
  }

  async recordPromptArtifacts(
    runId: string,
    promptId: string,
    inputArtifactPath: string,
    outputArtifactPath: string,
    redacted: boolean,
    redactionReason?: string
  ): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const inputMetadata = await readFileMetadata(this.paths.projectArtifact(inputArtifactPath), this.fileStore);
    const outputMetadata = await readFileMetadata(this.paths.projectArtifact(outputArtifactPath), this.fileStore);
    const targetIndex = findLastIndex(manifest.promptCalls, (call) => call.promptId === promptId);
    if (targetIndex !== -1) {
      const existing = manifest.promptCalls[targetIndex]!;
      manifest.promptCalls[targetIndex] = {
        ...existing,
        inputArtifactPath,
        outputArtifactPath,
        inputHash: inputMetadata.sha256,
        outputHash: outputMetadata.sha256,
        redacted: existing.redacted === true || redacted,
        ...(redactionReason === undefined && existing.redactionReason === undefined ? {} : { redactionReason: redactionReason ?? existing.redactionReason })
      };
    }
    updateSummary(manifest);
    return this.writeManifest(manifest);
  }

  async recordQueueTransition(runId: string, transition: Omit<QueueTransitionRecord, 'transitionId' | 'runId' | 'timestamp'>): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const record: QueueTransitionRecord = {
      transitionId: `queue_${String(manifest.queueTransitions.length + 1).padStart(3, '0')}`,
      ...transition,
      runId,
      timestamp: this.now().toISOString()
    };
    manifest.queueTransitions.push(record);
    if (manifest.resolvedContext.chapterNumber === transition.chapterNumber) {
      manifest.resolvedContext.queueStatusAfter = transition.afterStatus;
    }
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, 'QUEUE_TRANSITION', {
      stage: transition.afterStage,
      chapterNumber: transition.chapterNumber,
      relatedArtifactPaths: transition.relatedArtifactPath === undefined ? [] : [transition.relatedArtifactPath],
      payload: record
    });
    return manifest;
  }

  async recordStateMutation(runId: string, mutation: Omit<StateMutationRecord, 'mutationId'>): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const record: StateMutationRecord = {
      mutationId: `mutation_${String(manifest.stateMutations.length + 1).padStart(3, '0')}`,
      ...mutation
    };
    manifest.stateMutations.push(record);
    manifest.resolvedContext.latestCommittedChapterAfter = record.latestCommittedChapterAfter ?? manifest.resolvedContext.latestCommittedChapterAfter;
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, record.applied ? 'STATE_MUTATION_APPLIED' : 'STATE_MUTATION_BLOCKED', {
      stage: 'commit',
      ...(record.chapterNumber === undefined ? {} : { chapterNumber: record.chapterNumber }),
      relatedArtifactPaths: record.patchPath === undefined ? [] : [record.patchPath],
      payload: record,
      severity: record.applied ? 'info' : 'warning'
    });
    return manifest;
  }

  async recordEvent(
    runId: string,
    eventType: RunEventType,
    input: {
      stage?: string;
      chapterNumber?: number;
      payload?: unknown;
      relatedArtifactPaths?: string[];
      severity?: 'info' | 'warning' | 'error' | 'critical';
      timestamp?: string;
    } = {}
  ): Promise<RunEvent> {
    return this.appendEvent(runId, eventType, input);
  }

  async recordStageStatus(
    runId: string,
    input: {
      stage: string;
      status: 'started' | 'completed' | 'failed';
      chapterNumber?: number;
      payload?: unknown;
      relatedArtifactPaths?: string[];
      severity?: 'info' | 'warning' | 'error' | 'critical';
    }
  ): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const timestamp = this.now().toISOString();
    const existing = manifest.stages.find((stage) => stage.name === input.stage);
    if (existing === undefined) {
      manifest.stages.push({
        stage: input.stage,
        name: input.stage,
        status: input.status,
        startedAt: timestamp,
        ...(input.status === 'started' ? {} : { endedAt: timestamp }),
        ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber })
      });
    } else {
      existing.status = input.status;
      if (existing.startedAt === undefined) existing.startedAt = timestamp;
      if (input.status !== 'started') {
        existing.endedAt = timestamp;
        existing.durationMs = Math.max(0, Date.parse(timestamp) - Date.parse(existing.startedAt));
      }
    }
    updateSummary(manifest);
    await this.writeManifest(manifest);
    const eventType =
      input.status === 'started'
        ? input.stage.startsWith('preview.')
          ? 'CODEX_PREVIEW_SUBSTAGE_STARTED'
          : 'STAGE_STARTED'
        : input.status === 'failed'
          ? input.stage.startsWith('preview.')
            ? 'CODEX_PREVIEW_SUBSTAGE_FAILED'
            : 'STAGE_FAILED'
          : input.stage.startsWith('preview.')
            ? 'CODEX_PREVIEW_SUBSTAGE_COMPLETED'
            : 'STAGE_COMPLETED';
    await this.appendEvent(runId, eventType, {
      stage: input.stage,
      ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
      payload: input.payload ?? { stage: input.stage, status: input.status },
      relatedArtifactPaths: input.relatedArtifactPaths ?? [],
      severity: input.severity ?? (input.status === 'failed' ? 'error' : 'info')
    });
    return manifest;
  }

  async recordSnapshot(
    runId: string,
    snapshot: { snapshotId: string; path: string; reason?: string | undefined; sourceChapter?: number | undefined },
    storyStateInput?: unknown
  ): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const relativePath = path.join('snapshots', `${snapshot.snapshotId}.json`);
    const stateHash = storyStateInput === undefined ? undefined : hashJson(StoryStateSchema.parse(storyStateInput));
    if (!manifest.snapshots.some((item) => item.snapshotId === snapshot.snapshotId)) {
      manifest.snapshots.push({
        snapshotId: snapshot.snapshotId,
        path: relativePath,
        ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
        ...(snapshot.sourceChapter === undefined ? {} : { chapterNumber: snapshot.sourceChapter }),
        ...(stateHash === undefined ? {} : { stateHash })
      });
    }
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, 'SNAPSHOT_CREATED', {
      stage: 'snapshot',
      ...(snapshot.sourceChapter === undefined ? {} : { chapterNumber: snapshot.sourceChapter }),
      relatedArtifactPaths: [relativePath],
      payload: { snapshotId: snapshot.snapshotId, path: relativePath, ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }) }
    });
    return manifest;
  }

  async recordReusePolicy(
    runId: string,
    input: { reportPath?: string; chapterNumber?: number; requestedPolicy: ReusePolicy; effectivePolicy: ReusePolicy; downgradeReason?: string }
  ): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const record = {
      ...(input.reportPath === undefined ? {} : { reportPath: input.reportPath }),
      ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
      requestedPolicy: input.requestedPolicy,
      effectivePolicy: input.effectivePolicy,
      ...(input.downgradeReason === undefined ? {} : { downgradeReason: input.downgradeReason })
    };
    manifest.reusePolicies.push(record);
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, 'REUSE_POLICY_EVALUATED', {
      stage: 'reuse_policy',
      ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
      relatedArtifactPaths: input.reportPath === undefined ? [] : [input.reportPath],
      payload: record
    });
    return manifest;
  }

  async endRun(runId: string, status: Exclude<RunStatus, 'running'>): Promise<RunManifestV2> {
    const manifest = await this.readManifestV2(runId);
    const endedAt = this.now().toISOString();
    manifest.status = normalizeStatus(status);
    manifest.endedAt = endedAt;
    manifest.durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(manifest.startedAt));
    manifest.resolvedContext = await this.mergeResolvedContextAfter(manifest);
    updateSummary(manifest);
    await this.writeManifest(manifest);
    await this.appendEvent(runId, manifest.status === 'failed' ? 'RUN_FAILED' : 'RUN_COMPLETED', {
      severity: manifest.status === 'failed' ? 'error' : 'info',
      payload: { status: manifest.status, summary: manifest.summary }
    });
    return manifest;
  }

  async readManifest(runId: string): Promise<RunManifest> {
    return this.fileStore.readJson(this.paths.runManifest(runId), RunManifestSchema);
  }

  async readManifestV2(runId: string): Promise<RunManifestV2> {
    const manifest = await this.readManifest(runId);
    const parsed = RunManifestV2Schema.safeParse(manifest);
    if (parsed.success) {
      return parsed.data;
    }
    return this.upgradeLegacy(manifest as LegacyRunManifest);
  }

  private async writeManifest(manifest: RunManifestV2): Promise<RunManifestV2> {
    updateSummary(manifest);
    return this.fileStore.writeJson(this.paths.runManifest(manifest.runId), manifest, RunManifestV2Schema);
  }

  private async appendEvent(
    runId: string,
    eventType: RunEventType,
    input: {
      stage?: string;
      chapterNumber?: number;
      payload?: unknown;
      relatedArtifactPaths?: string[];
      severity?: 'info' | 'warning' | 'error' | 'critical';
      timestamp?: string;
    } = {}
  ): Promise<RunEvent> {
    const event = RunEventSchema.parse({
      eventId: `event_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      runId,
      projectId: this.paths.projectId,
      timestamp: input.timestamp ?? this.now().toISOString(),
      eventType,
      ...(input.stage === undefined ? {} : { stage: input.stage }),
      ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
      payload: input.payload ?? {},
      relatedArtifactPaths: input.relatedArtifactPaths ?? [],
      severity: input.severity ?? 'info'
    });
    await this.fileStore.appendText(this.paths.runEvents(runId), `${JSON.stringify(event)}\n`);
    return event;
  }

  private async buildResolvedContext(command: string, args: Record<string, unknown>, phase: 'before' | 'after'): Promise<RunResolvedContext> {
    const chapterNumber = numberArg(args, 'chapterNumber');
    const state = await this.readStoryState();
    const queueStatus = chapterNumber === undefined ? undefined : await this.readQueueStatus(chapterNumber);
    const requestedChapter = typeof args.requestedChapter === 'string' || typeof args.requestedChapter === 'number' ? args.requestedChapter : chapterNumber;
    return {
      projectId: this.paths.projectId,
      ...(chapterNumber === undefined ? {} : { chapterNumber, requestedChapter, resolvedChapterNumber: chapterNumber }),
      mode: modeFor(command, args),
      ...(phase === 'before'
        ? {
            ...(state === undefined ? {} : { latestCommittedChapterBefore: state.latestCommittedChapter }),
            ...(queueStatus === undefined ? {} : { queueStatusBefore: queueStatus.status })
          }
        : {
            ...(state === undefined ? {} : { latestCommittedChapterAfter: state.latestCommittedChapter }),
            ...(queueStatus === undefined ? {} : { queueStatusAfter: queueStatus.status })
          })
    };
  }

  private async mergeResolvedContextAfter(manifest: RunManifestV2) {
    const after = await this.buildResolvedContext(manifest.command, manifest.args, 'after');
    return {
      ...manifest.resolvedContext,
      latestCommittedChapterAfter: after.latestCommittedChapterAfter ?? manifest.resolvedContext.latestCommittedChapterAfter,
      queueStatusAfter: after.queueStatusAfter ?? manifest.resolvedContext.queueStatusAfter
    };
  }

  private async readStoryState(): Promise<{ latestCommittedChapter: number } | undefined> {
    if (!(await this.fileStore.exists(this.paths.storyState()))) return undefined;
    return this.fileStore.readJson(this.paths.storyState(), StoryStateSchema);
  }

  private async readQueueStatus(chapterNumber: number): Promise<{ status: string; currentStage: string } | undefined> {
    if (!(await this.fileStore.exists(this.paths.chapterQueue()))) return undefined;
    const parsed = JSON.parse(await this.fileStore.readText(this.paths.chapterQueue())) as {
      chapters?: Array<{ chapterNumber?: number; status?: string; currentStage?: string }>;
    };
    const chapter = parsed.chapters?.find((item) => item.chapterNumber === chapterNumber);
    if (chapter?.status === undefined) return undefined;
    return { status: chapter.status, currentStage: chapter.currentStage ?? 'none' };
  }

  private redactionPolicy() {
    const redactUserContent = this.env.NLE_REDACT_PROMPT_ARTIFACTS === 'true' || this.env.NLE_REAL_REDACT_PROMPT_ARTIFACTS === 'true';
    return {
      savePromptInputs: true,
      savePromptOutputs: true,
      redactSecrets: true,
      redactUserContent,
      redactedFields: redactUserContent ? ['prompt.user', 'prompt.system', 'response.text'] : []
    };
  }

  private async readPackageVersion(): Promise<string> {
    try {
      const packageJson = JSON.parse(await this.fileStore.readText(path.resolve('package.json'))) as { version?: string };
      return packageJson.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private upgradeLegacy(manifest: Exclude<RunManifest, RunManifestV2>): RunManifestV2 {
    return RunManifestV2Schema.parse({
      schemaVersion: '2',
      runId: manifest.runId,
      projectId: manifest.projectId,
      command: manifest.command,
      args: manifest.args,
      argv: buildArgv(manifest.command, manifest.args),
      cwd: process.cwd(),
      startedAt: manifest.startedAt,
      endedAt: manifest.endedAt,
      durationMs: manifest.endedAt === undefined ? undefined : Math.max(0, Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt)),
      status: normalizeStatus(manifest.status),
      packageVersion: 'legacy',
      nodeVersion: 'legacy',
      provider: typeof manifest.args.provider === 'string' ? manifest.args.provider : undefined,
      redactionPolicy: this.redactionPolicy(),
      resolvedContext: {
        projectId: manifest.projectId,
        ...(numberArg(manifest.args, 'chapterNumber') === undefined ? {} : { chapterNumber: numberArg(manifest.args, 'chapterNumber') }),
        mode: modeFor(manifest.command, manifest.args)
      },
      promptCalls: manifest.llmCalls,
      artifacts: manifest.artifacts.map((artifactPath) => {
        const classification = classifyArtifact(artifactPath);
        return {
          artifactId: artifactId(artifactPath),
          artifactType: classification.artifactType,
          path: artifactPath,
          ...(chapterNumberFromPath(artifactPath) === undefined ? {} : { chapterNumber: chapterNumberFromPath(artifactPath) }),
          phase: classification.phase,
          action: 'generated',
          runId: manifest.runId,
          status: 'active',
          sourceArtifactIds: [],
          sourcePaths: [],
          derivedFrom: [],
          provenanceNote: 'legacy run manifest artifact'
        };
      }),
      errors: manifest.errors,
      summary: emptySummary()
    });
  }
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function emptySummary() {
  return {
    generatedArtifactCount: 0,
    reusedArtifactCount: 0,
    archivedArtifactCount: 0,
    promptCallCount: 0,
    queueTransitionCount: 0,
    stateMutationCount: 0,
    snapshotCount: 0,
    errorCount: 0
  };
}

function updateSummary(manifest: RunManifestV2): void {
  manifest.summary = {
    generatedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'generated').length,
    reusedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'reused').length,
    archivedArtifactCount: manifest.artifacts.filter((artifact) => artifact.action === 'archived').length,
    promptCallCount: manifest.promptCalls.length,
    queueTransitionCount: manifest.queueTransitions.length,
    stateMutationCount: manifest.stateMutations.length,
    snapshotCount: manifest.snapshots.length,
    errorCount: manifest.errors.length
  };
}

function ensureStage(manifest: RunManifestV2, stage: string | undefined, chapterNumber: number | undefined, timestamp: string, status: 'completed' | 'failed'): void {
  if (stage === undefined) return;
  const existing = manifest.stages.find((item) => item.name === stage);
  if (existing === undefined) {
    manifest.stages.push({ stage, name: stage, status, startedAt: timestamp, endedAt: timestamp, chapterNumber });
    return;
  }
  existing.status = status;
  existing.endedAt = timestamp;
}

function buildArgv(command: string, args: Record<string, unknown>): string[] {
  const argv = [command];
  if (typeof args.chapterNumber === 'number') argv.push(String(args.chapterNumber));
  if (typeof args.provider === 'string') argv.push('--provider', args.provider);
  if (args.dryRun === true) argv.push('--dry-run');
  if (typeof args.until === 'string') argv.push('--until', args.until);
  if (args.commit === true) argv.push('--commit');
  if (args.regenerateStale === true) argv.push('--regenerate-stale');
  return argv;
}

function normalizeStatus(status: RunStatus): RunManifestV2['status'] {
  if (status === 'completed' || status === 'human_review_required') return 'success';
  if (status === 'cancelled') return 'blocked';
  return status;
}

function modeFor(command: string, args: Record<string, unknown>): RunManifestV2['resolvedContext']['mode'] {
  if (command === 'recommit' && args.allowHistoricalRecommit === true) return 'historical_recommit';
  if (command === 'recommit') return 'recommit';
  if (args.resume === true) return 'resume';
  if (args.repairConflicts === true) return 'conflict_repair';
  if (args.regenerateStale === true) return 'regenerate_stale';
  if (args.dryRun === true) return 'dry_run';
  if (args.until === 'draft') return 'draft';
  if (args.commit === true) return 'commit';
  if (command === 'audit') return 'audit';
  if (command === 'run' || command === 'runs' || command === 'artifacts') return 'browser';
  if (command === 'codex' || command.startsWith('codex ')) return 'codex';
  return 'normal';
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === 'number' ? args[key] : undefined;
}

function classifyArtifact(relativePath: string): { artifactType: ArtifactLineageRecord['artifactType']; phase: string; schemaName?: string } {
  const normalized = relativePath.split(path.sep).join(path.posix.sep);
  const fileName = path.posix.basename(normalized);
  if (normalized.startsWith('codex/runs/') && fileName === 'prompt.md') return { artifactType: 'prompt_artifact', phase: 'codex' };
  if (normalized.startsWith('codex/runs/') && fileName === 'raw_output.jsonl') return { artifactType: 'codex_raw_output', phase: 'codex' };
  if (normalized.startsWith('codex/runs/') && fileName === 'parsed_output.json') return { artifactType: 'codex_parsed_json', phase: 'codex' };
  if (normalized.startsWith('codex/runs/') && fileName.startsWith('final_output.')) return { artifactType: 'codex_final_output', phase: 'codex' };
  if (/^codex\/context\/context_manifest_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_context_manifest', phase: 'context', schemaName: 'CodexContextManifestSchema' };
  if (normalized.startsWith('snapshots/') && fileName.endsWith('.json')) return { artifactType: 'snapshot', phase: 'snapshot', schemaName: 'SnapshotSchema' };
  if (normalized.startsWith('diffs/')) {
    return fileName.endsWith('.json')
      ? { artifactType: 'state_diff', phase: 'diff', schemaName: 'StateDiffReportSchema' }
      : { artifactType: 'state_diff', phase: 'diff' };
  }
  if (normalized.startsWith('planning/regeneration_plan_')) {
    return fileName.endsWith('.json')
      ? { artifactType: 'regeneration_plan', phase: 'planning', schemaName: 'RegenerationPlanSchema' }
      : { artifactType: 'regeneration_plan', phase: 'planning' };
  }
  if (normalized === 'state/story_state.json') return { artifactType: 'story_state', phase: 'state', schemaName: 'StoryStateSchema' };
  if (normalized.endsWith('/manifest.json') && normalized.includes('/archive/')) return { artifactType: 'archive_manifest', phase: 'archive', schemaName: 'ArchiveManifestSchema' };
  if (fileName === 'mission.json') return { artifactType: 'mission', phase: 'chapter_planning', schemaName: 'ChapterMissionSchema' };
  if (normalized.includes('/plan_candidates/')) return { artifactType: 'plan_candidate', phase: 'chapter_planning' };
  if (fileName === 'ranking.json') return { artifactType: 'ranking', phase: 'chapter_planning', schemaName: 'ChapterPlanRankingSchema' };
  if (fileName === 'selected_plan.md') return { artifactType: 'selected_plan', phase: 'chapter_planning' };
  if (fileName === 'scene_cards.json') return { artifactType: 'scene_card', phase: 'drafting', schemaName: 'SceneCardsSchema' };
  if (normalized.includes('/scenes/')) return { artifactType: 'scene_draft', phase: 'drafting' };
  if (/^draft_v\d+\.md$/.test(fileName)) return { artifactType: 'draft', phase: 'drafting' };
  if (/^diagnostics_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics', phase: 'diagnostics', schemaName: 'DiagnosticsReportSchema' };
  if (/^revision_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'revision_plan', phase: 'revision', schemaName: 'RevisionPlanSchema' };
  if (fileName === 'final.md') return { artifactType: 'final', phase: 'final' };
  if (fileName === 'canon_patch.json' || /^canon_patch_(manual|repaired)_v\d+\.json$/.test(fileName) || /^canon_patch_codex_(proposal|normalized)_v\d+\.json$/.test(fileName)) return { artifactType: 'canon_patch', phase: 'commit', schemaName: 'CanonPatchSchema' };
  if (fileName === 'commit_report.json') return { artifactType: 'commit_report', phase: 'commit', schemaName: 'CommitReportSchema' };
  if (/^codex_commit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'commit_report', phase: 'commit', schemaName: 'CodexCommitReportSchema' };
  if (/^codex_commit_consistency_report_v\d+\.json$/.test(fileName)) return { artifactType: 'state_diff', phase: 'commit', schemaName: 'CodexCommitConsistencyReportSchema' };
  if (/^codex_patch_failure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_patch_failure_report', phase: 'commit', schemaName: 'CodexPatchFailureReportSchema' };
  if (/^codex_preview_completeness_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_preview_completeness_report', phase: 'commit', schemaName: 'CodexPreviewCompletenessReportSchema' };
  if (/^codex_preview_completeness_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_preview_completeness_report', phase: 'commit' };
  if (/^codex_preview_failure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_preview_failure_report', phase: 'commit', schemaName: 'CodexPreviewFailureReportSchema' };
  if (/^codex_preview_failure_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_preview_failure_report', phase: 'commit' };
  if (/^diagnostics_schema_compliance_report_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_schema_compliance_report', phase: 'diagnostics', schemaName: 'DiagnosticsSchemaComplianceReportSchema' };
  if (/^diagnostics_schema_compliance_report_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_schema_compliance_report', phase: 'diagnostics' };
  if (/^diagnostics_normalization_report_v\d+\.json$/.test(fileName)) return { artifactType: 'diagnostics_normalization_report', phase: 'diagnostics', schemaName: 'DiagnosticsNormalizationReportSchema' };
  if (/^diagnostics_normalization_report_v\d+\.md$/.test(fileName)) return { artifactType: 'diagnostics_normalization_report', phase: 'diagnostics' };
  if (/^codex_diagnostics_schema_benchmark_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_schema_benchmark', phase: 'diagnostics', schemaName: 'CodexDiagnosticsSchemaBenchmarkReportSchema' };
  if (/^codex_diagnostics_schema_benchmark_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_schema_benchmark', phase: 'diagnostics' };
  if (/^codex_diagnostics_evidence_adjudication_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_diagnostics_evidence_adjudication', phase: 'diagnostics', schemaName: 'CodexDiagnosticsEvidenceAdjudicationSchema' };
  if (/^codex_diagnostics_evidence_adjudication_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_diagnostics_evidence_adjudication', phase: 'diagnostics' };
  if (/^timeline_contradiction_map_v\d+\.json$/.test(fileName)) return { artifactType: 'timeline_contradiction_map', phase: 'diagnostics', schemaName: 'TimelineContradictionMapSchema' };
  if (/^timeline_contradiction_map_v\d+\.md$/.test(fileName)) return { artifactType: 'timeline_contradiction_map', phase: 'diagnostics' };
  if (/^targeted_revision_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_plan', phase: 'revision', schemaName: 'TargetedRevisionPlanSchema' };
  if (/^targeted_revision_plan_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_plan', phase: 'revision' };
  if (/^draft_targeted_revision_candidate_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_candidate', phase: 'revision' };
  if (/^targeted_revision_scope_validation_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_scope_validation', phase: 'revision', schemaName: 'TargetedRevisionScopeValidationSchema' };
  if (/^targeted_revision_scope_validation_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_scope_validation', phase: 'revision' };
  if (/^targeted_revision_diff_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_diff', phase: 'revision', schemaName: 'TargetedRevisionDiffSchema' };
  if (/^targeted_revision_diff_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_diff', phase: 'revision' };
  if (/^targeted_revision_experiment_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_experiment', phase: 'diagnostics', schemaName: 'TargetedRevisionExperimentReportSchema' };
  if (/^targeted_revision_experiment_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_experiment', phase: 'diagnostics' };
  if (/^targeted_revision_candidate_disposition_v\d+\.json$/.test(fileName)) return { artifactType: 'targeted_revision_candidate_disposition', phase: 'revision', schemaName: 'CandidateDispositionSchema' };
  if (/^targeted_revision_candidate_disposition_v\d+\.md$/.test(fileName)) return { artifactType: 'targeted_revision_candidate_disposition', phase: 'revision' };
  if (/^target_coverage_graph_v\d+\.json$/.test(fileName)) return { artifactType: 'target_coverage_graph', phase: 'diagnostics', schemaName: 'TargetCoverageGraphSchema' };
  if (/^target_coverage_graph_v\d+\.md$/.test(fileName)) return { artifactType: 'target_coverage_graph', phase: 'diagnostics' };
  if (/^target_coverage_closure_report_v\d+\.json$/.test(fileName)) return { artifactType: 'target_coverage_closure_report', phase: 'diagnostics', schemaName: 'TargetCoverageClosureReportSchema' };
  if (/^target_coverage_closure_report_v\d+\.md$/.test(fileName)) return { artifactType: 'target_coverage_closure_report', phase: 'diagnostics' };
  if (/^target_expansion_approval_preview_v\d+\.json$/.test(fileName)) return { artifactType: 'target_expansion_approval_preview', phase: 'diagnostics', schemaName: 'TargetExpansionApprovalPreviewSchema' };
  if (/^target_expansion_approval_preview_v\d+\.md$/.test(fileName)) return { artifactType: 'target_expansion_approval_preview', phase: 'diagnostics' };
  if (/^target_expansion_approval_v\d+\.json$/.test(fileName)) return { artifactType: 'target_expansion_approval', phase: 'diagnostics', schemaName: 'TargetExpansionApprovalRecordSchema' };
  if (/^target_expansion_approval_v\d+\.md$/.test(fileName)) return { artifactType: 'target_expansion_approval', phase: 'diagnostics' };
  if (/^codex_chapter_quality_report_v\d+\.json$/.test(fileName)) return { artifactType: 'codex_chapter_quality_report', phase: 'quality', schemaName: 'CodexChapterQualityReportSchema' };
  if (/^codex_chapter_quality_report_v\d+\.md$/.test(fileName)) return { artifactType: 'codex_chapter_quality_report', phase: 'quality' };
  if (fileName === 'chapter_summary_for_context.json') return { artifactType: 'codex_chapter_context_summary', phase: 'context', schemaName: 'ChapterContextSummarySchema' };
  if (fileName === 'chapter_summary_for_context.md') return { artifactType: 'codex_chapter_context_summary', phase: 'context' };
  if (/^final_assembly_report_v\d+\.json$/.test(fileName)) return { artifactType: 'final_assembly_report', phase: 'final', schemaName: 'FinalAssemblyReportSchema' };
  if (/^final_assembly_report_v\d+\.md$/.test(fileName)) return { artifactType: 'final_assembly_report', phase: 'final' };
  if (/^strategy\/build_bible_cache_report_v\d+\.json$/.test(normalized)) return { artifactType: 'build_bible_cache_report', phase: 'strategy', schemaName: 'BuildBibleCacheReportSchema' };
  if (/^strategy\/build_bible_cache_report_v\d+\.md$/.test(normalized)) return { artifactType: 'build_bible_cache_report', phase: 'strategy' };
  if (/^audit\/codex_single_chapter_smoke_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_single_chapter_smoke_report', phase: 'audit', schemaName: 'CodexSingleChapterSmokeReportSchema' };
  if (/^audit\/codex_single_chapter_smoke_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_single_chapter_smoke_report', phase: 'audit' };
  if (/^audit\/codex_multi_chapter_pilot_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_multi_chapter_pilot_report', phase: 'audit', schemaName: 'CodexMultiChapterPilotReportSchema' };
  if (/^audit\/codex_multi_chapter_pilot_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_multi_chapter_pilot_report', phase: 'audit' };
  if (/^audit\/codex_cross_chapter_drift_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_cross_chapter_drift_report', phase: 'audit', schemaName: 'CodexCrossChapterDriftReportSchema' };
  if (/^audit\/codex_cross_chapter_drift_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_cross_chapter_drift_report', phase: 'audit' };
  if (/^audit\/codex_cross_chapter_continuity_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_cross_chapter_continuity_report', phase: 'audit', schemaName: 'CodexCrossChapterContinuityReportSchema' };
  if (/^audit\/codex_cross_chapter_continuity_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_cross_chapter_continuity_report', phase: 'audit' };
  if (/^audit\/codex_budget_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_budget_report', phase: 'audit', schemaName: 'CodexBudgetReportSchema' };
  if (/^audit\/codex_budget_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_budget_report', phase: 'audit' };
  if (/^audit\/codex_call_reduction_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_call_reduction_report', phase: 'audit', schemaName: 'CodexCallReductionReportSchema' };
  if (/^audit\/codex_call_reduction_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_call_reduction_report', phase: 'audit' };
  if (/^audit\/codex_stage_runtime_profile_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_stage_runtime_profile_report', phase: 'audit', schemaName: 'CodexStageRuntimeProfileReportSchema' };
  if (/^audit\/codex_stage_runtime_profile_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_stage_runtime_profile_report', phase: 'audit' };
  if (/^audit\/codex_business_optimization_plan_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_business_optimization_plan', phase: 'audit', schemaName: 'CodexBusinessOptimizationPlanSchema' };
  if (/^audit\/codex_business_optimization_plan_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_business_optimization_plan', phase: 'audit' };
  if (/^audit\/codex_runtime_benchmark_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_runtime_benchmark_report', phase: 'audit', schemaName: 'CodexRuntimeBenchmarkReportSchema' };
  if (/^audit\/codex_runtime_benchmark_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_runtime_benchmark_report', phase: 'audit' };
  if (/^audit\/codex_runtime_optimization_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_runtime_optimization_report', phase: 'audit', schemaName: 'CodexRuntimeOptimizationReportSchema' };
  if (/^audit\/codex_runtime_optimization_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_runtime_optimization_report', phase: 'audit' };
  if (/^audit\/codex_real_optimization_benchmark_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_real_optimization_benchmark_report', phase: 'audit', schemaName: 'CodexRealOptimizationBenchmarkReportSchema' };
  if (/^audit\/codex_real_optimization_benchmark_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_real_optimization_benchmark_report', phase: 'audit' };
  if (/^audit\/codex_chapter_regression_analysis_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_chapter_regression_analysis', phase: 'audit', schemaName: 'CodexChapterRegressionAnalysisSchema' };
  if (/^audit\/codex_chapter_regression_analysis_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_chapter_regression_analysis', phase: 'audit' };
  if (/^audit\/codex_runtime_gap_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_runtime_gap_report', phase: 'audit', schemaName: 'CodexRuntimeGapReportSchema' };
  if (/^audit\/codex_runtime_gap_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_runtime_gap_report', phase: 'audit' };
  if (/^audit\/codex_runtime_sampling_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_runtime_sampling_report', phase: 'audit', schemaName: 'CodexRuntimeSamplingReportSchema' };
  if (/^audit\/codex_runtime_sampling_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_runtime_sampling_report', phase: 'audit' };
  if (/^audit\/codex_mission_retry_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_mission_retry_report', phase: 'audit', schemaName: 'CodexMissionRetryReportSchema' };
  if (/^audit\/codex_mission_retry_report_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_mission_retry_report', phase: 'audit' };
  if (/^audit\/codex_mission_micro_benchmark_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_mission_micro_benchmark_report', phase: 'audit', schemaName: 'CodexMissionMicroBenchmarkReportSchema' };
  if (/^audit\/codex_mission_micro_benchmark_v\d+\.md$/.test(normalized)) return { artifactType: 'codex_mission_micro_benchmark_report', phase: 'audit' };
  if (/^audit\/mission_schema_diagnostics_v\d+\.json$/.test(normalized)) return { artifactType: 'mission_schema_diagnostics_report', phase: 'audit', schemaName: 'MissionSchemaDiagnosticsReportSchema' };
  if (/^audit\/mission_schema_diagnostics_v\d+\.md$/.test(normalized)) return { artifactType: 'mission_schema_diagnostics_report', phase: 'audit' };
  if (/^audit\/codex_runtime_failure_report_v\d+\.json$/.test(normalized)) return { artifactType: 'codex_runtime_failure_report', phase: 'audit', schemaName: 'CodexRuntimeFailureReportSchema' };
  if (/^conflict_report_v\d+\.json$/.test(fileName)) return { artifactType: 'conflict_report', phase: 'conflict', schemaName: 'ConflictReportSchema' };
  if (/^patch_repair_plan_v\d+\.json$/.test(fileName)) return { artifactType: 'repair_plan', phase: 'conflict', schemaName: 'PatchRepairPlanSchema' };
  if (/^manual_review_report_v\d+\.json$/.test(fileName)) return { artifactType: 'manual_review_report', phase: 'review', schemaName: 'ManualReviewReportSchema' };
  if (/^recommit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'recommit_report', phase: 'recommit', schemaName: 'RecommitReportSchema' };
  if (/^(codex_)?approval_record_v\d+\.json$/.test(fileName)) return { artifactType: 'approval_record', phase: normalized.includes('/codex_') ? 'commit' : 'recommit', schemaName: 'ApprovalRecordSchema' };
  if (/^downstream_invalidation_report_v\d+\.json$/.test(fileName)) return { artifactType: 'downstream_invalidation_report', phase: 'historical_recommit', schemaName: 'DownstreamInvalidationReportSchema' };
  if (/^historical_recommit_report_v\d+\.json$/.test(fileName)) return { artifactType: 'historical_recommit_report', phase: 'historical_recommit', schemaName: 'HistoricalRecommitReportSchema' };
  return { artifactType: 'brief', phase: 'unknown' };
}

function stageFromPhase(phase: string): string {
  if (phase === 'chapter_planning') return 'planning';
  if (phase === 'drafting') return 'draft';
  return phase;
}

function eventForArtifactAction(action: ArtifactAction, exists: boolean): RunEventType {
  if (!exists || action === 'invalid') return 'ARTIFACT_INVALID';
  if (action === 'reused') return 'ARTIFACT_REUSED';
  if (action === 'archived') return 'ARTIFACT_ARCHIVED';
  return 'ARTIFACT_GENERATED';
}

function defaultProvenanceNote(action: ArtifactAction, runId: string): string {
  if (action === 'reused') return `reused by ${runId}`;
  if (action === 'archived') return `archived by ${runId}`;
  return `generated by ${runId}`;
}

function artifactId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function chapterNumberFromPath(relativePath: string): number | undefined {
  const normalized = relativePath.split(path.sep).join(path.posix.sep);
  const match = /^chapters\/chapter_(\d{3})\//.exec(normalized);
  return match === null ? undefined : Number.parseInt(match[1]!, 10);
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}
