import type { Command } from 'commander';

import { createStressFixture } from '../../app/stressFixture.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface StressFixtureOptions {
  root?: string;
  chapters?: string;
  runsPerChapter?: string;
  extraEventsPerRun?: string;
}

export function registerStressFixtureCommand(program: Command): void {
  program
    .command('stress-fixture')
    .description('Create a deterministic long-project stress fixture')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--chapters <count>', 'number of committed chapters to generate, 1-50', '30')
    .option('--runs-per-chapter <count>', 'run manifests per generated chapter', '2')
    .option('--extra-events-per-run <count>', 'extra validation events per run for compaction tests', '0')
    .action(async (projectId: string, options: StressFixtureOptions) => {
      const result = await createStressFixture({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapters: parseNonnegativeInteger(options.chapters ?? '30', 'chapters'),
        runsPerChapter: parseNonnegativeInteger(options.runsPerChapter ?? '2', 'runs-per-chapter'),
        extraEventsPerRun: parseNonnegativeInteger(options.extraEventsPerRun ?? '0', 'extra-events-per-run')
      });
      process.stdout.write(
        [
          `stressFixtureCreated: ${result.projectId}`,
          `chapters: ${result.chapterCount}`,
          `runs: ${result.runCount}`,
          `snapshots: ${result.snapshotCount}`,
          `projectRoot: ${result.paths.projectRoot}`
        ].join('\n') + '\n'
      );
    });
}

function parseNonnegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a non-negative integer`, 2);
  }
  return parsed;
}
