import type { Command } from 'commander';

import { planGlobal } from '../../app/planGlobal.js';
import type { ProviderName } from '../../llm/ProviderFactory.js';
import { addCodexOptions, resolveCodexCliOptionsIfNeeded } from '../codexOptions.js';
import { PROJECTS_ROOT_OPTION_HELP, PROVIDER_OPTION_HELP } from '../help.js';

interface PlanGlobalCommandOptions {
  provider?: ProviderName;
  root?: string;
  codexBin?: string;
  codexProfile?: string;
  codexJsonRetries?: string;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: string;
}

export function registerPlanGlobalCommand(program: Command): void {
  addCodexOptions(
    program
    .command('plan-global')
    .description('Generate global planning artifacts from strategy')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--provider <provider>', PROVIDER_OPTION_HELP, 'mock')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
  )
    .action(async (projectId: string, options: PlanGlobalCommandOptions) => {
      const result = await planGlobal({
        projectId,
        projectsRoot: options.root ?? './projects',
        provider: options.provider ?? 'mock',
        ...resolveCodexCliOptionsIfNeeded(options)
      });

      console.log(`Planned global structure for project: ${result.projectId}`);
      console.log(`Run: ${result.runId}`);
      console.log('Artifacts:');
      for (const artifact of result.artifacts) {
        console.log(`- ${artifact}`);
      }
    });
}
