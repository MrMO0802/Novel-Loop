import type { Command } from 'commander';

import { reviewChapter } from '../../app/reviewChapter.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface ReviewCommandOptions {
  root?: string;
  conflicts?: boolean;
  diagnostics?: boolean;
  state?: boolean;
  artifacts?: boolean;
  suggestNext?: boolean;
}

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('Review chapter status and manual intervention context')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<chapterNumber>', 'chapter number')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--conflicts', 'show conflict report summaries', false)
    .option('--diagnostics', 'show diagnostics summary', false)
    .option('--state', 'show Story State context summary', false)
    .option('--artifacts', 'show review-related artifacts', false)
    .option('--suggest-next', 'show suggested next command', false)
    .action(async (projectId: string, chapterNumberText: string, options: ReviewCommandOptions) => {
      const output = await reviewChapter({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapterNumber: parsePositiveInteger(chapterNumberText, 'chapterNumber'),
        conflicts: options.conflicts === true,
        diagnostics: options.diagnostics === true,
        state: options.state === true,
        artifacts: options.artifacts === true,
        suggestNext: options.suggestNext === true
      });
      console.log(output.trimEnd());
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
