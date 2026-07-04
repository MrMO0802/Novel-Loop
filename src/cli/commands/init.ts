import type { Command } from 'commander';

import { initProject } from '../../app/initProject.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface InitCommandOptions {
  brief: string;
  root?: string;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new novel project')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .requiredOption('--brief <path>', 'path to a brief markdown file')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, options: InitCommandOptions) => {
      const result = await initProject({
        projectId,
        briefPath: options.brief,
        projectsRoot: options.root ?? './projects'
      });

      console.log(`Initialized project: ${result.projectId}`);
      console.log(`Project root: ${result.projectRoot}`);
      console.log('Created:');
      for (const createdPath of result.created) {
        console.log(`- ${createdPath}`);
      }
    });
}
