import path from 'node:path';

import { RunEventSchema, RunManifestSchema } from '../schemas/index.js';
import type {
  ArtifactLineageRecord,
  LegacyRunManifest,
  LLMCallRecord,
  QueueTransitionRecord,
  RunError,
  RunEvent,
  RunManifest,
  RunManifestV2,
  StateMutationRecord
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface ListRunsInput {
  projectId: string;
  projectsRoot?: string;
  limit?: number;
  status?: 'success' | 'failed';
  chapterNumber?: number;
  json?: boolean;
}

export interface RunSummary {
  runId: string;
  command: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  provider?: string;
  mockScenario?: string;
  chapterNumber?: number;
  artifactCount: number;
  errorCount: number;
  schemaVersion: '2' | 'legacy';
}

export interface ListRunsResult {
  projectId: string;
  runCount: number;
  failedRunCount: number;
  lastRun?: RunSummary;
  runs: RunSummary[];
  output: string;
}

export interface RunDetailResult {
  run: RunManifest;
  schemaVersion: '2' | 'legacy';
  mode: string;
  durationMs?: number;
  provider?: string;
  mockScenario?: string;
  chapterNumber?: number;
  stages: string[];
  events: RunEvent[];
  artifactsGenerated: string[];
  artifactsReused: string[];
  archivedArtifacts: string[];
  artifactLineage: ArtifactLineageRecord[];
  artifactLineageSummary: {
    generated: number;
    reused: number;
    archived: number;
    invalid: number;
    missing: number;
  };
  errors: RunError[];
  promptCalls: LLMCallRecord[];
  stateMutations: StateMutationRecord[];
  snapshotIds: string[];
  queueTransitions: QueueTransitionRecord[];
  redactionPolicy: Record<string, unknown>;
  redaction: {
    promptArtifactsMayContainSensitiveText: boolean;
  };
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function listRuns(input: ListRunsInput, fileStore = new FileStore()): Promise<ListRunsResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const manifests = await readRunManifests(paths, fileStore);
  const summaries = manifests.map(toSummary).filter((run) => {
    if (input.status === 'failed' && run.status !== 'failed') return false;
    if (input.status === 'success' && run.status !== 'success' && run.status !== 'completed') return false;
    if (input.chapterNumber !== undefined && run.chapterNumber !== input.chapterNumber) return false;
    return true;
  });
  const sorted = summaries.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, input.limit ?? summaries.length);
  const result: Omit<ListRunsResult, 'output'> = {
    projectId: paths.projectId,
    runCount: sorted.length,
    failedRunCount: summaries.filter((run) => run.status === 'failed').length,
    ...(sorted[0] === undefined ? {} : { lastRun: sorted[0] }),
    runs: sorted
  };
  return {
    ...result,
    output: input.json === true ? `${JSON.stringify(result, null, 2)}\n` : renderRuns(result)
  };
}

export async function readRunDetail(
  input: { projectId: string; projectsRoot?: string; runId: string },
  fileStore = new FileStore()
): Promise<RunDetailResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const run = await fileStore.readJson(paths.runManifest(input.runId), RunManifestSchema);
  const summary = toSummary(run);
  const events = await readEvents(paths, fileStore, input.runId, isV2(run));
  const lineage = isV2(run) ? run.artifacts : legacyArtifactLineage(run);
  const promptCalls = isV2(run) ? run.promptCalls : run.llmCalls;
  const queueTransitions = isV2(run) ? run.queueTransitions : [];
  const stateMutations = isV2(run) ? run.stateMutations : [];
  const snapshotIds = isV2(run)
    ? run.snapshots.map((snapshot) => snapshot.snapshotId)
    : run.artifacts
        .filter((artifact) => artifact.startsWith('snapshots/snapshot_') && artifact.endsWith('.json'))
        .map((artifact) => path.basename(artifact, '.json'));
  return {
    run,
    schemaVersion: isV2(run) ? '2' : 'legacy',
    mode: isV2(run) ? run.resolvedContext.mode : 'normal',
    ...(summary.durationMs === undefined ? {} : { durationMs: summary.durationMs }),
    ...(summary.provider === undefined ? {} : { provider: summary.provider }),
    ...(summary.mockScenario === undefined ? {} : { mockScenario: summary.mockScenario }),
    ...(summary.chapterNumber === undefined ? {} : { chapterNumber: summary.chapterNumber }),
    stages: isV2(run) ? run.stages.map((stage) => stage.name) : inferStages(run.artifacts),
    events,
    artifactsGenerated: lineage.filter((artifact) => artifact.action === 'generated').map((artifact) => artifact.path),
    artifactsReused: lineage.filter((artifact) => artifact.action === 'reused').map((artifact) => artifact.path),
    archivedArtifacts: lineage.filter((artifact) => artifact.action === 'archived').map((artifact) => artifact.path),
    artifactLineage: lineage,
    artifactLineageSummary: summarizeLineage(lineage),
    errors: run.errors,
    promptCalls,
    stateMutations,
    snapshotIds,
    queueTransitions,
    redactionPolicy: isV2(run) ? run.redactionPolicy : {},
    redaction: {
      promptArtifactsMayContainSensitiveText: !isV2(run) || run.redactionPolicy.redactUserContent !== true
    }
  };
}

async function readRunManifests(paths: ProjectPaths, fileStore: FileStore): Promise<RunManifest[]> {
  if (!(await fileStore.exists(paths.runsDir()))) {
    return [];
  }
  const manifests: RunManifest[] = [];
  for (const runId of await fileStore.list(paths.runsDir())) {
    const manifestPath = paths.runManifest(runId);
    if (await fileStore.exists(manifestPath)) {
      manifests.push(await fileStore.readJson(manifestPath, RunManifestSchema));
    }
  }
  return manifests;
}

async function readEvents(paths: ProjectPaths, fileStore: FileStore, runId: string, v2: boolean): Promise<RunEvent[]> {
  if (!v2 || !(await fileStore.exists(paths.runEvents(runId)))) {
    return [];
  }
  const text = await fileStore.readText(paths.runEvents(runId));
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => RunEventSchema.parse(JSON.parse(line)));
}

function toSummary(run: RunManifest): RunSummary {
  const durationMs =
    run.endedAt === undefined
      ? undefined
      : 'durationMs' in run && run.durationMs !== undefined
        ? run.durationMs
        : Date.parse(run.endedAt) - Date.parse(run.startedAt);
  const provider = providerFor(run);
  const mockScenario = mockScenarioFor(run);
  const chapterNumber = chapterNumberFor(run);
  return {
    runId: run.runId,
    command: run.command,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    ...(durationMs === undefined || Number.isNaN(durationMs) ? {} : { durationMs }),
    ...(provider === undefined ? {} : { provider }),
    ...(mockScenario === undefined ? {} : { mockScenario }),
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
    artifactCount: run.artifacts.length,
    errorCount: run.errors.length,
    schemaVersion: isV2(run) ? '2' : 'legacy'
  };
}

function isV2(run: RunManifest): run is RunManifestV2 {
  return 'schemaVersion' in run && run.schemaVersion === '2';
}

function providerFor(run: RunManifest): string | undefined {
  if (isV2(run)) return run.provider ?? (typeof run.args.provider === 'string' ? run.args.provider : undefined);
  return typeof run.args.provider === 'string' ? run.args.provider : undefined;
}

function mockScenarioFor(run: RunManifest): string | undefined {
  if (isV2(run)) return run.mockScenario ?? (typeof run.args.mockScenario === 'string' ? run.args.mockScenario : undefined);
  return typeof run.args.mockScenario === 'string' ? run.args.mockScenario : undefined;
}

function chapterNumberFor(run: RunManifest): number | undefined {
  if (isV2(run)) return run.resolvedContext.chapterNumber ?? (typeof run.args.chapterNumber === 'number' ? run.args.chapterNumber : undefined);
  return typeof run.args.chapterNumber === 'number' ? run.args.chapterNumber : undefined;
}

function legacyArtifactLineage(run: LegacyRunManifest): ArtifactLineageRecord[] {
  return run.artifacts.map((artifactPath) => ({
    artifactId: artifactPath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    artifactType: 'brief',
    path: artifactPath,
    phase: 'legacy',
    action: 'generated',
    runId: run.runId,
    status: 'active',
    sourceArtifactIds: [],
    sourcePaths: [],
    derivedFrom: [],
    provenanceNote: 'legacy manifest artifact'
  }));
}

function summarizeLineage(lineage: ArtifactLineageRecord[]): RunDetailResult['artifactLineageSummary'] {
  return {
    generated: lineage.filter((artifact) => artifact.action === 'generated').length,
    reused: lineage.filter((artifact) => artifact.action === 'reused').length,
    archived: lineage.filter((artifact) => artifact.action === 'archived').length,
    invalid: lineage.filter((artifact) => artifact.status === 'invalid').length,
    missing: lineage.filter((artifact) => artifact.status === 'missing').length
  };
}

function inferStages(artifacts: string[]): string[] {
  const stages = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.includes('mission') || artifact.includes('ranking')) stages.add('planning');
    if (artifact.includes('scene') || artifact.includes('draft')) stages.add('drafting');
    if (artifact.includes('diagnostics')) stages.add('diagnostics');
    if (artifact.includes('revision')) stages.add('revision');
    if (artifact.includes('canon_patch') || artifact.includes('commit_report')) stages.add('commit');
  }
  return [...stages];
}

function renderRuns(result: Omit<ListRunsResult, 'output'>): string {
  const failed = result.runs.find((run) => run.status === 'failed');
  const lines = [
    `runCount: ${result.runCount}`,
    `failedRunCount: ${result.failedRunCount}`,
    `lastRun: ${result.lastRun?.runId ?? 'none'}`,
    `suggestedFailedRunCommand: ${failed === undefined ? 'none' : `corepack pnpm novel-loop run ${result.projectId} ${failed.runId}`}`
  ];
  for (const run of result.runs) {
    lines.push(`- ${run.runId} ${run.status} ${run.command} schemaVersion=${run.schemaVersion}`);
  }
  return `${lines.join('\n')}\n`;
}

export function assertRunExists(detail: RunDetailResult | undefined): RunDetailResult {
  if (detail === undefined) {
    throw new AppError('RUN_NOT_FOUND', 'Run manifest not found.', 2);
  }
  return detail;
}
