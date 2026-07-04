import type { Command } from 'commander';

import { readSnapshotDetail } from '../../app/snapshotBrowser.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface SnapshotCommandOptions {
  root?: string;
  json?: boolean;
}

export function registerSnapshotCommand(program: Command): void {
  program
    .command('snapshot')
    .description('Inspect one Story State snapshot')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<snapshotId>', 'snapshot id')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, snapshotId: string, options: SnapshotCommandOptions) => {
      const detail = await readSnapshotDetail({ projectId, projectsRoot: options.root ?? './projects', snapshotId });
      if (options.json === true) {
        console.log(JSON.stringify(detail, null, 2));
        return;
      }
      console.log(`snapshotId: ${detail.snapshotId}`);
      console.log(`path: ${detail.path}`);
      console.log(`createdAt: ${detail.createdAt}`);
      console.log(`reason: ${detail.reason}`);
      console.log(`chapterNumber: ${detail.chapterNumber ?? 'none'}`);
      console.log(`relatedRunId: ${detail.relatedRunId ?? 'none'}`);
      console.log(`relatedReportPath: ${detail.relatedReportPath ?? 'none'}`);
      console.log(`latestCommittedChapter: ${detail.latestCommittedChapter}`);
      console.log(`storyStateHash: ${detail.sha256}`);
      console.log(`sizeBytes: ${detail.sizeBytes}`);
      console.log(`schemaValid: ${String(detail.schemaValid)}`);
    });
}
