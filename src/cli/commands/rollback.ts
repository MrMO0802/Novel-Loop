import type { Command } from 'commander';

import { rollbackProject } from '../../app/rollbackProject.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface RollbackCommandOptions {
  root?: string;
  snapshot: string;
}

export function registerRollbackCommand(program: Command): void {
  program
    .command('rollback')
    .description('Restore Story State from a snapshot without deleting artifacts')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .requiredOption('--snapshot <snapshotId>', 'snapshot id to restore')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, options: RollbackCommandOptions) => {
      const result = await rollbackProject({
        projectId,
        projectsRoot: options.root ?? './projects',
        snapshotId: options.snapshot
      });

      console.log(`Rollback complete: ${projectId}`);
      console.log(`Snapshot: ${result.report.snapshotId}`);
      console.log(`Restored latestCommittedChapter: ${result.report.restoredLatestCommittedChapter}`);
      console.log('Artifacts:');
      for (const artifact of result.artifacts) {
        console.log(`- ${artifact}`);
      }
    });
}
