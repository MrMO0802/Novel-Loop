import type { Command } from 'commander';

import { applyRetentionPolicy, previewRetentionPolicy } from '../../app/retention.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface RetentionOptions {
  root?: string;
  keepRuns?: string;
  keepArchivesPerChapter?: string;
  apply?: boolean;
  json?: boolean;
}

export function registerRetentionCommand(program: Command): void {
  program
    .command('retention')
    .description('Preview or apply run and archive retention policy')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--keep-runs <count>', 'number of newest runs to keep in runs/', '50')
    .option('--keep-archives-per-chapter <count>', 'number of newest archives to keep per chapter', '2')
    .option('--apply', 'apply retention; default is preview only', false)
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: RetentionOptions) => {
      const input = {
        projectId,
        projectsRoot: options.root ?? './projects',
        keepRuns: parsePositiveInteger(options.keepRuns ?? '50', 'keep-runs'),
        keepArchivesPerChapter: parseNonnegativeInteger(options.keepArchivesPerChapter ?? '2', 'keep-archives-per-chapter')
      };
      const report = options.apply === true ? await applyRetentionPolicy(input) : await previewRetentionPolicy(input);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `applied: ${String(report.applied)}`,
          `keepRuns: ${report.policy.keepRuns}`,
          `candidateRuns: ${report.candidateRunIds.length}`,
          `retainedRuns: ${report.retainedRunIds.length}`,
          `keptRuns: ${report.keptRunIds.length}`,
          `reportPath: ${report.reportPath ?? 'preview-only'}`
        ].join('\n') + '\n'
      );
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}

function parseNonnegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a non-negative integer`, 2);
  }
  return parsed;
}
