import type { Command } from 'commander';

import { checkCodexStatus, execCodexJson, execCodexText, runCodexSmoke } from '../../app/codexBoundary.js';
import { runCodexSingleChapterSmoke } from '../../app/codexSingleChapterSmoke.js';
import { inspectProvider } from '../../providers/providerRegistry.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface CodexCommandOptions {
  codexBin?: string;
  root?: string;
  projectId?: string;
  json?: boolean;
  prompt?: string;
  schema?: string;
  brief?: string;
  promptRoot?: string;
}

export function registerCodexCommand(program: Command): void {
  const codex = program.command('codex').description('Run local Codex CLI within a read-only execution boundary');
  addBoundaryOptions(codex);

  addBoundaryOptions(codex.command('status').description('Check local Codex CLI binary, login status, and doctor health')).action(async (options: CodexCommandOptions, command: Command) => {
    options = mergedOptions(options, command);
    const result = await checkCodexStatus(baseOptions(options));
    const provider = await inspectProvider('codex-text', baseOptions(options));
    const health = provider.health;
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify({ ...result, ...health, binaryFound: result.binaryFound, healthOk: result.healthOk }, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      [
        `codexStatus: ${health.providerAvailable ? 'available' : 'unavailable'}`,
        `binaryFound: ${result.binaryFound}`,
        `binaryAvailable: ${health.binaryAvailable}`,
        `binaryPath: ${result.binaryPath}`,
        `version: ${result.version}`,
        `loginStatus: ${result.loginStatus}`,
        `loginAvailable: ${health.loginAvailable}`,
        `doctorHealthy: ${health.doctorHealthy}`,
        `healthOk: ${result.healthOk}`,
        `doctorWarning: ${health.doctorHealthy ? 'none' : 'non-blocking if smoke/json pass'}`,
        `execSmokeOk: ${health.execSmokeOk}`,
        `execJsonOk: ${health.execJsonOk}`,
        `providerAvailable: ${health.providerAvailable}`,
        `sandboxDefault: ${result.sandbox}`
      ].join('\n') + '\n'
    );
  });

  addBoundaryOptions(codex.command('smoke').description('Run a read-only Codex exec smoke test')).action(async (options: CodexCommandOptions, command: Command) => {
    options = mergedOptions(options, command);
    const result = await runCodexSmoke(baseOptions(options));
    process.stdout.write(
      [
        `codexSmoke: ${result.ok ? 'success' : 'failed'}`,
        `sandbox: ${result.sandbox}`,
        `runId: ${result.runId}`,
        `rawOutputPath: ${result.rawOutputPath}`,
        `finalOutputPath: ${result.finalOutputPath}`
      ].join('\n') + '\n'
    );
  });

  addBoundaryOptions(codex.command('exec-text').description('Run Codex exec against a prompt file and save text output'))
    .requiredOption('--prompt <path>', 'prompt markdown file')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await execCodexText({
        ...baseOptions(options),
        promptPath: requiredOption(options.prompt, 'prompt')
      });
      process.stdout.write(
        [
          'codexExecText: success',
          `sandbox: ${result.sandbox}`,
          `runId: ${result.runId}`,
          `rawOutputPath: ${result.rawOutputPath}`,
          `finalOutputPath: ${result.finalOutputPath}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('exec-json').description('Run Codex exec with --output-schema and save parsed JSON output'))
    .requiredOption('--prompt <path>', 'prompt markdown file')
    .requiredOption('--schema <path>', 'JSON schema file passed to codex exec --output-schema')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await execCodexJson({
        ...baseOptions(options),
        promptPath: requiredOption(options.prompt, 'prompt'),
        schemaPath: requiredOption(options.schema, 'schema')
      });
      process.stdout.write(
        [
          'codexExecJson: success',
          `sandbox: ${result.sandbox}`,
          `runId: ${result.runId}`,
          `rawOutputPath: ${result.rawOutputPath}`,
          `finalOutputPath: ${result.finalOutputPath}`,
          `parsedJsonPath: ${result.parsedJsonPath}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('single-chapter-smoke').description('Run a controlled Codex single-chapter full-loop smoke'))
    .option('--brief <path>', 'brief markdown path', './examples/brief.md')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexSingleChapterSmoke({
        projectId: options.projectId ?? 'codex-single',
        projectsRoot: options.root ?? './projects',
        briefPath: options.brief ?? './examples/brief.md',
        promptRoot: options.promptRoot ?? './prompts',
        ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `codexSingleChapterSmoke: ${result.report.success ? 'success' : 'failed'}`,
            `reportPath: ${result.reportPath}`,
            `markdownPath: ${result.markdownPath}`,
            `previewRunId: ${result.report.previewRunId ?? 'none'}`,
            `confirmedRunId: ${result.report.confirmedRunId ?? 'none'}`,
            `latestCommittedChapterAfter: ${result.report.latestCommittedChapterAfter}`,
            `qualityReportPath: ${result.report.qualityReportPath ?? 'none'}`
          ].join('\n') + '\n'
        );
      }
      if (!result.report.success) {
        process.exitCode = 1;
      }
    });
}

function mergedOptions(options: CodexCommandOptions, command: Command): CodexCommandOptions {
  return {
    ...options,
    ...(command.optsWithGlobals() as CodexCommandOptions)
  };
}

function addBoundaryOptions(command: Command): Command {
  return command
    .option('--codex-bin <path>', 'path to local codex CLI binary')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--project-id <projectId>', 'project id used for Codex provenance artifacts', 'codex-boundary')
    .option('--json', 'print JSON output', false);
}

function baseOptions(options: CodexCommandOptions) {
  return {
    ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
    projectsRoot: options.root ?? './projects',
    projectId: options.projectId ?? 'codex-boundary'
  };
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}
