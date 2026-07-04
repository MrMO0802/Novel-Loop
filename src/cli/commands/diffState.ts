import type { Command } from 'commander';

import { diffState } from '../../app/stateDiff.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface DiffStateCommandOptions {
  root?: string;
  from?: string;
  to?: string;
  patch?: string;
}

export function registerDiffStateCommand(program: Command): void {
  program
    .command('diff-state')
    .description('Generate Story State diff artifacts')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--from <snapshotId>', 'source snapshot id')
    .option('--to <snapshotId>', 'target snapshot id')
    .option('--patch <canonPatchPath>', 'preview a canon patch without modifying Story State')
    .action(async (projectId: string, options: DiffStateCommandOptions) => {
      if (options.patch !== undefined && (options.from !== undefined || options.to !== undefined)) {
        throw new AppError('DIFF_STATE_OPTION_CONFLICT', 'Use either --patch or --from/--to, not both.', 2);
      }
      const result = await diffState({
        projectId,
        projectsRoot: options.root ?? './projects',
        ...(options.from === undefined ? {} : { fromSnapshot: options.from }),
        ...(options.to === undefined ? {} : { toSnapshot: options.to }),
        ...(options.patch === undefined ? {} : { patchPath: options.patch })
      });
      console.log(`State diff generated: ${projectId}`);
      console.log(`mode: ${result.report.mode}`);
      console.log(`unsafeToCommit: ${String(result.report.unsafeToCommit)}`);
      console.log(`json: ${result.relativeJsonPath}`);
      console.log(`markdown: ${result.relativeMarkdownPath}`);
      console.log(`changes: ${result.report.summary.totalChanges}`);
    });
}
