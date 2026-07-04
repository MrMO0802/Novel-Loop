import type { Command } from 'commander';

import { listRuns } from '../../app/runBrowser.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface RunsCommandOptions {
  root?: string;
  limit?: string;
  status?: string;
  chapter?: string;
  json?: boolean;
}

export function registerRunsCommand(program: Command): void {
  program
    .command('runs')
    .description('List project run manifests')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--limit <count>', 'maximum runs to show', '20')
    .option('--status <status>', 'filter by status: success or failed')
    .option('--chapter <chapterNumber>', 'filter by chapter number')
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: RunsCommandOptions) => {
      const status = options.status === undefined ? undefined : parseStatus(options.status);
      const result = await listRuns({
        projectId,
        projectsRoot: options.root ?? './projects',
        limit: parsePositiveInteger(options.limit ?? '20', 'limit'),
        ...(status === undefined ? {} : { status }),
        ...(options.chapter === undefined ? {} : { chapterNumber: parsePositiveInteger(options.chapter, 'chapter') }),
        json: options.json === true
      });
      process.stdout.write(result.output);
    });
}

function parseStatus(value: string): 'success' | 'failed' {
  if (value === 'success' || value === 'failed') return value;
  throw new AppError('INVALID_RUN_STATUS', '--status must be success or failed.', 2);
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
