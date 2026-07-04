import path from 'node:path';

import { RollbackReportSchema, StoryStateSchema } from '../schemas/index.js';
import type { RollbackReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';

export interface RollbackProjectInput {
  projectId: string;
  projectsRoot?: string;
  snapshotId: string;
}

export interface RollbackProjectResult {
  report: RollbackReport;
  artifacts: string[];
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function rollbackProject(input: RollbackProjectInput, fileStore = new FileStore()): Promise<RollbackProjectResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const snapshotStore = new SnapshotStore(paths, fileStore);
  const snapshotId = normalizeSnapshotId(input.snapshotId);
  const snapshot = await snapshotStore.readSnapshot(snapshotId);
  const storyState = StoryStateSchema.parse(snapshot.storyState);

  await fileStore.writeJson(paths.storyState(), storyState, StoryStateSchema);

  const report: RollbackReport = {
    projectId: paths.projectId,
    snapshotId,
    restoredSnapshotPath: snapshot.meta.path,
    storyStatePath: path.join('state', 'story_state.json'),
    restoredLatestCommittedChapter: storyState.latestCommittedChapter,
    preservedArtifacts: true,
    rolledBackAt: new Date().toISOString()
  };
  const reportPath = path.join(paths.stateDir(), 'rollback_report.json');
  const writtenReport = await fileStore.writeJson(reportPath, report, RollbackReportSchema);

  return {
    report: writtenReport,
    artifacts: [path.join('state', 'story_state.json'), path.join('state', 'rollback_report.json')]
  };
}

function normalizeSnapshotId(snapshotId: string): string {
  return snapshotId.endsWith('.json') ? snapshotId.slice(0, -'.json'.length) : snapshotId;
}
