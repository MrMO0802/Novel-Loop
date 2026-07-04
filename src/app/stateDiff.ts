import path from 'node:path';

import { CanonPatchSchema, StateDiffReportSchema, StoryStateSchema } from '../schemas/index.js';
import type { CanonPatch, StateDiffChange, StateDiffReport, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';
import { AppError } from '../utils/AppError.js';
import { checkPatchConflicts } from './chapterCommit.js';

export interface DiffStateInput {
  projectId: string;
  projectsRoot?: string;
  fromSnapshot?: string;
  toSnapshot?: string;
  patchPath?: string;
}

export interface WritePatchPreviewDiffInput {
  projectId: string;
  paths: ProjectPaths;
  patch: CanonPatch;
  patchPath: string;
  unsafeToCommit: boolean;
  baseStoryState?: StoryState;
}

export interface DiffStateResult {
  report: StateDiffReport;
  jsonPath: string;
  markdownPath: string;
  relativeJsonPath: string;
  relativeMarkdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function diffState(input: DiffStateInput, fileStore = new FileStore()): Promise<DiffStateResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.diffsDir());

  if (input.patchPath !== undefined) {
    const patch = await fileStore.readJson(input.patchPath, CanonPatchSchema);
    const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    const conflicts = checkPatchConflicts(storyState, patch);
    return writePatchPreviewDiff(
      {
        projectId: paths.projectId,
        paths,
        patch,
        patchPath: input.patchPath,
        unsafeToCommit: conflicts.hard.length > 0
      },
      fileStore
    );
  }

  if (input.fromSnapshot === undefined || input.toSnapshot === undefined) {
    throw new AppError('DIFF_STATE_INPUT_REQUIRED', 'Use --from/--to snapshots or --patch for diff-state.', 2);
  }

  const snapshotStore = new SnapshotStore(paths, fileStore);
  const [fromSnapshot, toSnapshot] = await Promise.all([
    snapshotStore.readSnapshot(input.fromSnapshot),
    snapshotStore.readSnapshot(input.toSnapshot)
  ]);
  const changes = diffStoryStates(fromSnapshot.storyState, toSnapshot.storyState);
  const report = await writeDiffReport(
    paths,
    fileStore,
    {
      diffId: createDiffId(),
      projectId: paths.projectId,
      mode: 'snapshot_to_snapshot',
      fromSnapshot: input.fromSnapshot,
      toSnapshot: input.toSnapshot,
      generatedAt: new Date().toISOString(),
      unsafeToCommit: false,
      summary: summarizeChanges(changes),
      changes
    },
    'Snapshot to Snapshot State Diff'
  );
  return report;
}

export async function writePatchPreviewDiff(input: WritePatchPreviewDiffInput, fileStore = new FileStore()): Promise<DiffStateResult> {
  await fileStore.ensureDir(input.paths.diffsDir());
  const storyState = input.baseStoryState ?? (await fileStore.readJson(input.paths.storyState(), StoryStateSchema));
  const changes = diffPatchPreview(storyState, input.patch);
  return writeDiffReport(
    input.paths,
    fileStore,
    {
      diffId: createDiffId(),
      projectId: input.projectId,
      mode: 'patch_preview',
      patchPath: input.patchPath,
      generatedAt: new Date().toISOString(),
      unsafeToCommit: input.unsafeToCommit,
      summary: summarizeChanges(changes),
      changes
    },
    'Patch Preview State Diff'
  );
}

function diffStoryStates(before: StoryState, after: StoryState): StateDiffChange[] {
  const changes: StateDiffChange[] = [];
  pushScalarChange(changes, '/latestCommittedChapter', before.latestCommittedChapter, after.latestCommittedChapter);
  pushCollectionChanges(changes, '/canonFacts', before.canonFacts, after.canonFacts, (item) => item.id);
  pushCollectionChanges(changes, '/characters', before.characters, after.characters, (item) => item.id);
  pushCollectionChanges(changes, '/timeline', before.timeline, after.timeline, (item) => item.id);
  pushCollectionChanges(changes, '/narrativeDebts', before.narrativeDebts, after.narrativeDebts, (item) => item.id);
  pushCollectionChanges(changes, '/foreshadowing', before.foreshadowing, after.foreshadowing, (item) => item.id);
  pushScalarChange(changes, '/readerState', before.readerState, after.readerState);
  pushScalarChange(changes, '/relationshipGraph', before.relationshipGraph, after.relationshipGraph);
  return changes;
}

function diffPatchPreview(storyState: StoryState, patch: CanonPatch): StateDiffChange[] {
  const changes: StateDiffChange[] = [];
  for (const fact of patch.newFacts) {
    changes.push(createChange(`/canonFacts/${fact.id}`, 'added', null, fact, 'low', `Adds canon fact ${fact.id}.`));
  }
  for (const character of patch.characterStates) {
    const before = storyState.characters.find((candidate) => candidate.id === character.id) ?? null;
    changes.push(createChange(`/characters/${character.id}`, before === null ? 'added' : 'modified', before, character, 'medium', `Upserts character ${character.id}.`));
  }
  for (const update of patch.characterUpdates) {
    const character = storyState.characters.find((candidate) => candidate.id === update.characterId);
    changes.push(
      createChange(
        `/characters/${update.characterId}/${update.field}`,
        'modified',
        character === undefined ? null : (character as Record<string, unknown>)[update.field],
        update.newValue,
        'medium',
        update.reason
      )
    );
  }
  for (const event of patch.timelineEvents) {
    changes.push(createChange(`/timeline/${event.id}`, 'added', null, event, 'medium', `Adds timeline event ${event.id}.`));
  }
  for (const update of patch.narrativeDebtUpdates) {
    const before = update.debtId === undefined ? null : storyState.narrativeDebts.find((debt) => debt.id === update.debtId) ?? null;
    changes.push(createChange(`/narrativeDebts/${update.debtId ?? 'new'}`, 'modified', before, update, 'high', `Applies narrative debt action ${update.action}.`));
  }
  for (const update of patch.foreshadowingUpdates) {
    const before =
      update.foreshadowingId === undefined ? null : storyState.foreshadowing.find((foreshadowing) => foreshadowing.id === update.foreshadowingId) ?? null;
    changes.push(createChange(`/foreshadowing/${update.foreshadowingId ?? 'new'}`, 'modified', before, update, 'medium', `Applies foreshadowing action ${update.action}.`));
  }
  changes.push(createChange('/readerState', 'modified', storyState.readerState, patch.readerStatePatch, 'medium', 'Applies reader state patch.'));
  for (const relationship of patch.relationshipUpdates) {
    changes.push(createChange('/relationshipGraph/edges', 'added', null, relationship, 'medium', 'Adds relationship graph edge.'));
  }
  pushScalarChange(changes, '/latestCommittedChapter', storyState.latestCommittedChapter, patch.latestCommittedChapter ?? patch.chapterNumber);
  return changes;
}

function pushCollectionChanges<T>(changes: StateDiffChange[], basePath: string, before: T[], after: T[], getId: (item: T) => string): void {
  const beforeById = new Map(before.map((item) => [getId(item), item]));
  const afterById = new Map(after.map((item) => [getId(item), item]));
  for (const [id, afterItem] of afterById) {
    const beforeItem = beforeById.get(id);
    if (beforeItem === undefined) {
      changes.push(createChange(`${basePath}/${id}`, 'added', null, afterItem, 'low', `Added ${id}.`));
    } else if (!sameJson(beforeItem, afterItem)) {
      changes.push(createChange(`${basePath}/${id}`, 'modified', beforeItem, afterItem, 'medium', `Modified ${id}.`));
    }
  }
  for (const [id, beforeItem] of beforeById) {
    if (!afterById.has(id)) {
      changes.push(createChange(`${basePath}/${id}`, 'removed', beforeItem, null, 'high', `Removed ${id}.`));
    }
  }
}

function pushScalarChange(changes: StateDiffChange[], changePath: string, before: unknown, after: unknown): void {
  changes.push(
    createChange(changePath, sameJson(before, after) ? 'unchanged' : 'modified', before, after, changePath === '/latestCommittedChapter' ? 'high' : 'medium', `Compares ${changePath}.`)
  );
}

function createChange(
  changePath: string,
  changeType: StateDiffChange['changeType'],
  before: unknown,
  after: unknown,
  riskLevel: StateDiffChange['riskLevel'],
  explanation: string
): StateDiffChange {
  return {
    path: changePath,
    changeType,
    before,
    after,
    riskLevel,
    explanation
  };
}

function summarizeChanges(changes: StateDiffChange[]): StateDiffReport['summary'] {
  return {
    totalChanges: changes.length,
    added: changes.filter((change) => change.changeType === 'added').length,
    removed: changes.filter((change) => change.changeType === 'removed').length,
    modified: changes.filter((change) => change.changeType === 'modified').length,
    unchanged: changes.filter((change) => change.changeType === 'unchanged').length,
    highRiskChanges: changes.filter((change) => change.riskLevel === 'high' || change.riskLevel === 'critical').length
  };
}

async function writeDiffReport(paths: ProjectPaths, fileStore: FileStore, reportInput: StateDiffReport, title: string): Promise<DiffStateResult> {
  const report = StateDiffReportSchema.parse(reportInput);
  const fileBase = await nextDiffFileBase(paths, fileStore, report.diffId);
  const jsonPath = paths.diffArtifact(`${fileBase}.json`);
  const markdownPath = paths.diffArtifact(`${fileBase}.md`);
  const written = await fileStore.writeJson(jsonPath, report, StateDiffReportSchema);
  await fileStore.writeText(markdownPath, renderMarkdown(title, written));
  return {
    report: written,
    jsonPath,
    markdownPath,
    relativeJsonPath: path.join('diffs', `${fileBase}.json`),
    relativeMarkdownPath: path.join('diffs', `${fileBase}.md`)
  };
}

async function nextDiffFileBase(paths: ProjectPaths, fileStore: FileStore, diffId: string): Promise<string> {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? diffId : `${diffId}_${suffix}`;
    if (!(await fileStore.exists(paths.diffArtifact(`${candidate}.json`)))) {
      return candidate;
    }
  }
  throw new AppError('STATE_DIFF_VERSION_EXHAUSTED', 'Could not allocate state diff artifact path.', 1);
}

function renderMarkdown(title: string, report: StateDiffReport): string {
  const lines = [
    `# ${title}`,
    '',
    `Project: ${report.projectId}`,
    `Mode: ${report.mode}`,
    `Unsafe to commit: ${String(report.unsafeToCommit)}`,
    `Total changes: ${report.summary.totalChanges}`,
    '',
    '## Changes'
  ];
  for (const change of report.changes) {
    lines.push(`- ${change.path} [${change.changeType}] risk=${change.riskLevel}: ${change.explanation}`);
  }
  return `${lines.join('\n')}\n`;
}

function createDiffId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `state_diff_${timestamp}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
