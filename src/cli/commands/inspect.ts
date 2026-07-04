import type { Command } from 'commander';

import { inspectProject } from '../../app/inspectProject.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface InspectCommandOptions {
  root?: string;
  debts?: boolean;
  characters?: boolean;
  reader?: boolean;
  timeline?: boolean;
  foreshadowing?: boolean;
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Inspect current Story State')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--debts', 'show open narrative debts', false)
    .option('--characters', 'show character state summaries', false)
    .option('--reader', 'show reader knowledge, suspicions, and expectations', false)
    .option('--timeline', 'show timeline summary', false)
    .option('--foreshadowing', 'show foreshadowing status', false)
    .action(async (projectId: string, options: InspectCommandOptions) => {
      const output = await inspectProject({
        projectId,
        projectsRoot: options.root ?? './projects',
        debts: options.debts === true,
        characters: options.characters === true,
        reader: options.reader === true,
        timeline: options.timeline === true,
        foreshadowing: options.foreshadowing === true
      });

      console.log(output.trimEnd());
    });
}
