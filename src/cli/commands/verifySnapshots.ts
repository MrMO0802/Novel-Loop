import type { Command } from 'commander';

import { verifySnapshots } from '../../app/snapshotBrowser.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface VerifySnapshotsCommandOptions {
  root?: string;
  json?: boolean;
}

export function registerVerifySnapshotsCommand(program: Command): void {
  program
    .command('verify-snapshots')
    .description('Verify Story State snapshots')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: VerifySnapshotsCommandOptions) => {
      const result = await verifySnapshots({ projectId, projectsRoot: options.root ?? './projects' });
      if (options.json === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`ok: ${String(result.ok)}`);
        console.log(`snapshotIssues: ${result.report.issues.length}`);
        console.log(`reportPath: ${result.reportPath}`);
        console.log(`markdownPath: ${result.markdownPath}`);
      }
      if (!result.ok) {
        process.exitCode = 2;
      }
    });
}
