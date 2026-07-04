import type { Command } from 'commander';

import { listArtifacts, refreshArtifactIndex } from '../../app/artifactIndex.js';
import { ArtifactStatusSchema, ArtifactTypeSchema } from '../../schemas/index.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface ArtifactsCommandOptions {
  root?: string;
  chapter?: string;
  type?: string;
  status?: string;
  json?: boolean;
  refresh?: boolean;
}

export function registerArtifactsCommand(program: Command): void {
  program
    .command('artifacts')
    .description('Browse and refresh project artifact index')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--chapter <chapterNumber>', 'filter artifacts by chapter')
    .option('--type <artifactType>', 'filter artifacts by type')
    .option('--status <status>', 'filter artifacts by status: active, archived, stale, missing, invalid')
    .option('--json', 'print JSON output', false)
    .option('--refresh', 'rescan project and write artifacts/artifact_index.json', false)
    .action(async (projectId: string, options: ArtifactsCommandOptions) => {
      const projectsRoot = options.root ?? './projects';
      if (options.refresh === true) {
        await refreshArtifactIndex({ projectId, projectsRoot });
      }
      const result = await listArtifacts({
        projectId,
        projectsRoot,
        ...(options.chapter === undefined ? {} : { chapterNumber: parsePositiveInteger(options.chapter, 'chapter') }),
        ...(options.type === undefined ? {} : { type: ArtifactTypeSchema.parse(options.type) }),
        ...(options.status === undefined ? {} : { status: ArtifactStatusSchema.parse(options.status) }),
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
