import type { Command } from 'commander';

import { inspectProvider, listProviders } from '../../providers/providerRegistry.js';
import type { ProviderId } from '../../providers/providerTypes.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface ProvidersCommandOptions {
  root?: string;
  projectId?: string;
  codexBin?: string;
  json?: boolean;
}

export function registerProvidersCommand(program: Command): void {
  const providers = program.command('providers').description('List and inspect LLM providers');

  providers
    .command('list')
    .description('List available providers')
    .option('--json', 'print JSON output', false)
    .action((options: ProvidersCommandOptions) => {
      const result = listProviders();
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify({ providers: result }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        result
          .map((provider) => `${provider.providerId}\ttransport=${provider.capabilities.transport}\tcommitDefault=${provider.capabilities.allowCommitByDefault}`)
          .join('\n') + '\n'
      );
    });

  providers
    .command('inspect')
    .description('Inspect one provider')
    .argument('<providerId>', 'provider id, e.g. codex-text')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--project-id <projectId>', 'project id used for provider health artifacts', 'codex-boundary')
    .option('--codex-bin <path>', 'path to local codex CLI binary')
    .option('--json', 'print JSON output', false)
    .action(async (providerId: ProviderId, options: ProvidersCommandOptions) => {
      const detail = await inspectProvider(providerId, {
        projectsRoot: options.root ?? './projects',
        projectId: options.projectId ?? 'codex-boundary',
        ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin })
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `providerId: ${detail.providerId}`,
          `binaryPath: ${detail.health.binaryPath ?? 'n/a'}`,
          `version: ${detail.health.version ?? 'n/a'}`,
          `loginStatus: ${detail.health.loginStatus ?? 'n/a'}`,
          `doctorStatus: ${detail.health.doctorStatus ?? 'n/a'}`,
          `doctorWarning: ${detail.health.doctorHealthy ? 'none' : 'non-blocking if smoke/json pass'}`,
          `execSmokeOk: ${detail.health.execSmokeOk}`,
          `execJsonOk: ${detail.health.execJsonOk}`,
          `providerAvailable: ${detail.health.providerAvailable}`,
          `available: ${detail.health.available}`,
          `supportsOutputSchema: ${detail.capabilities.supportsOutputSchema}`,
          `defaultSandbox: ${detail.capabilities.defaultSandbox}`,
          `allowCommitByDefault: ${detail.commitSafetyPolicy.allowCommitByDefault}`,
          `storyStateCommitAllowed: ${detail.commitSafetyPolicy.storyStateCommitAllowed}`,
          `workspaceWriteAllowed: ${detail.commitSafetyPolicy.workspaceWriteAllowed}`
        ].join('\n') + '\n'
      );
    });
}
