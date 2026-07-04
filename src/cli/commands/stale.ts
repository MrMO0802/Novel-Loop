import type { Command } from 'commander';

import { listStaleChapters } from '../../app/staleChapters.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface StaleCommandOptions {
  root?: string;
  chapter?: string;
  json?: boolean;
}

export function registerStaleCommand(program: Command): void {
  program
    .command('stale')
    .description('Inspect chapters invalidated by historical recommit')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--chapter <chapterNumber>', 'show one stale chapter')
    .option('--json', 'print stale chapter data as JSON', false)
    .action(async (projectId: string, options: StaleCommandOptions) => {
      const result = await listStaleChapters({
        projectId,
        projectsRoot: options.root ?? './projects',
        ...(options.chapter === undefined ? {} : { chapterNumber: parsePositiveInteger(options.chapter, 'chapter') }),
        json: options.json === true
      });
      process.stdout.write(result.output);
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
