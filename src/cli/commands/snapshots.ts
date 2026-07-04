import type { Command } from 'commander';

import { listSnapshotsForProject } from '../../app/snapshotBrowser.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface SnapshotsCommandOptions {
  root?: string;
  chapter?: string;
  kind?: string;
  json?: boolean;
}

export function registerSnapshotsCommand(program: Command): void {
  program
    .command('snapshots')
    .description('List Story State snapshots')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--chapter <chapterNumber>', 'filter snapshots by source chapter')
    .option('--kind <kind>', 'filter by kind: before, after, initial, manual')
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: SnapshotsCommandOptions) => {
      const kind = options.kind === undefined ? undefined : parseKind(options.kind);
      const result = await listSnapshotsForProject({
        projectId,
        projectsRoot: options.root ?? './projects',
        ...(options.chapter === undefined ? {} : { chapterNumber: parsePositiveInteger(options.chapter, 'chapter') }),
        ...(kind === undefined ? {} : { kind }),
        json: options.json === true
      });
      process.stdout.write(result.output);
    });
}

function parseKind(value: string): 'before' | 'after' | 'initial' | 'manual' {
  if (value === 'before' || value === 'after' || value === 'initial' || value === 'manual') return value;
  throw new AppError('INVALID_SNAPSHOT_KIND', '--kind must be before, after, initial, or manual.', 2);
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
