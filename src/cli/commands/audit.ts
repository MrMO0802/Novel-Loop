import type { Command } from 'commander';

import { auditProject } from '../../app/projectAudit.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface AuditCommandOptions {
  root?: string;
  json?: boolean;
  strict?: boolean;
  fixIndex?: boolean;
}

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Run project audit checks')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--json', 'print JSON output', false)
    .option('--strict', 'exit non-zero when audit finds error or critical issues', false)
    .option('--fix-index', 'refresh artifact index before auditing', false)
    .action(async (projectId: string, options: AuditCommandOptions) => {
      const result = await auditProject({
        projectId,
        projectsRoot: options.root ?? './projects',
        json: options.json === true,
        strict: options.strict === true,
        fixIndex: options.fixIndex === true
      });
      process.stdout.write(result.output);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });
}
