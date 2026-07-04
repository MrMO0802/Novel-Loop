import type { Command } from 'commander';

import { commitChapterState } from '../../app/chapterCommit.js';
import type { ProviderName } from '../../llm/ProviderFactory.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP, PROVIDER_OPTION_HELP } from '../help.js';

interface CommitChapterCommandOptions {
  provider?: ProviderName;
  root?: string;
}

export function registerCommitChapterCommand(program: Command): void {
  program
    .command('commit-chapter')
    .description('Commit an existing final.md into Story State')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<chapterNumber>', 'chapter number')
    .option('--provider <provider>', PROVIDER_OPTION_HELP, 'mock')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, chapterNumberText: string, options: CommitChapterCommandOptions) => {
      const chapterNumber = parsePositiveInteger(chapterNumberText, 'chapterNumber');
      const result = await commitChapterState({
        projectId,
        chapterNumber,
        projectsRoot: options.root ?? './projects',
        provider: options.provider ?? 'mock'
      });

      console.log(`Chapter commit complete: ${projectId} chapter ${chapterNumber}`);
      console.log(`Status: ${result.status}`);
      console.log('Artifacts:');
      for (const artifact of result.artifacts) {
        console.log(`- ${artifact}`);
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
