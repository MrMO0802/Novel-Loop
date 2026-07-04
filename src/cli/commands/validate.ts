import type { Command } from 'commander';

import { validateProject } from '../../app/validateProject.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface ValidateCommandOptions {
  root?: string;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate project structure and core JSON files')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .action(async (projectId: string, options: ValidateCommandOptions) => {
      const result = await validateProject({
        projectId,
        projectsRoot: options.root ?? './projects'
      });

      console.log(`Project: ${result.projectId}`);
      console.log(`Project root: ${result.projectRoot}`);
      for (const check of result.checks) {
        console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.message ? ` - ${check.message}` : ''}`);
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}
