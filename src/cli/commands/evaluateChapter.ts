import type { Command } from 'commander';

import { evaluateCodexChapterQuality } from '../../app/codexChapterQuality.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface EvaluateChapterOptions {
  root?: string;
}

export function registerEvaluateChapterCommand(program: Command): void {
  program
    .command('evaluate-chapter')
    .description('Run local deterministic quality checks for a Codex-generated chapter')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<chapterNumber>', 'chapter number')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, chapterNumberText: string, options: EvaluateChapterOptions) => {
      const chapterNumber = parsePositiveInteger(chapterNumberText, 'chapterNumber');
      const result = await evaluateCodexChapterQuality({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapterNumber
      });
      console.log(`qualityReportPath: ${result.reportPath}`);
      console.log(`qualityReportMarkdownPath: ${result.markdownPath}`);
      console.log(`blocking: ${String(result.blocking)}`);
      console.log(`criticalIssues: ${result.criticalIssues.length === 0 ? 'none' : result.criticalIssues.join('; ')}`);
      if (result.blocking) {
        process.exitCode = 1;
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
