import type { Command } from 'commander';

import { generateRegenerationPlan } from '../../app/regenerationPlan.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface RegenerationPlanCommandOptions {
  root?: string;
  from?: string;
}

export function registerRegenerationPlanCommand(program: Command): void {
  program
    .command('regeneration-plan')
    .description('Generate a downstream regeneration plan for stale chapters')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .requiredOption('--from <chapterNumber>', 'first stale chapter to include')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, options: RegenerationPlanCommandOptions) => {
      const from = parsePositiveInteger(options.from ?? '', 'from');
      const result = await generateRegenerationPlan({
        projectId,
        projectsRoot: options.root ?? './projects',
        fromChapter: from
      });
      console.log(`Regeneration plan created: ${result.planPath}`);
      console.log(`Markdown: ${result.markdownPath}`);
      console.log(`staleChapters: ${result.plan.staleChapters.join(', ') || 'none'}`);
      for (const command of result.plan.recommendedCommands) {
        console.log(`recommendedCommand: ${command}`);
      }
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
