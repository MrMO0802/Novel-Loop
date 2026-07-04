import type { Command } from 'commander';

import { buildBible } from '../../app/buildBible.js';
import type { ProviderName } from '../../llm/ProviderFactory.js';
import { addCodexOptions, resolveCodexCliOptionsIfNeeded } from '../codexOptions.js';
import { PROJECTS_ROOT_OPTION_HELP, PROVIDER_OPTION_HELP } from '../help.js';

interface BuildBibleCommandOptions {
  provider?: ProviderName;
  root?: string;
  force?: boolean;
  codexBin?: string;
  codexProfile?: string;
  codexJsonRetries?: string;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: string;
}

export function registerBuildBibleCommand(program: Command): void {
  addCodexOptions(
    program
    .command('build-bible')
    .description('Generate strategy artifacts from project brief')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--provider <provider>', PROVIDER_OPTION_HELP, 'mock')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
  )
    .option('--force', 'overwrite existing strategy artifacts', false)
    .action(async (projectId: string, options: BuildBibleCommandOptions) => {
      const result = await buildBible({
        projectId,
        projectsRoot: options.root ?? './projects',
        provider: options.provider ?? 'mock',
        ...resolveCodexCliOptionsIfNeeded(options),
        force: options.force ?? false
      });

      console.log(`Built bible artifacts for project: ${result.projectId}`);
      console.log(`Run: ${result.runId}`);
      console.log('Artifacts:');
      for (const artifact of result.artifacts) {
        console.log(`- ${artifact}`);
      }
    });
}
