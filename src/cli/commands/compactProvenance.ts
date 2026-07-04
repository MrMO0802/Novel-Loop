import type { Command } from 'commander';

import { compactProvenance } from '../../app/provenanceCompaction.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface CompactProvenanceOptions {
  root?: string;
  maxEventsPerRun?: string;
  apply?: boolean;
  json?: boolean;
}

export function registerCompactProvenanceCommand(program: Command): void {
  program
    .command('compact-provenance')
    .description('Compact oversized run event logs while preserving summary provenance')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--max-events-per-run <count>', 'maximum events to keep per run event log', '200')
    .option('--apply', 'apply compaction; default is preview report only', false)
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: CompactProvenanceOptions) => {
      const report = await compactProvenance({
        projectId,
        projectsRoot: options.root ?? './projects',
        maxEventsPerRun: parsePositiveInteger(options.maxEventsPerRun ?? '200', 'max-events-per-run'),
        apply: options.apply === true
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `applied: ${String(report.applied)}`,
          `scannedRuns: ${report.scannedRuns}`,
          `compactedRuns: ${report.compactedRuns.length}`,
          `totalEventsRemoved: ${report.totalEventsRemoved}`,
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
