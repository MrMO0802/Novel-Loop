import type { Command } from 'commander';
import path from 'node:path';

import { auditCodexPrompts } from '../../app/codexPromptAudit.js';

interface PromptCommandOptions {
  root?: string;
  maxPromptBytes?: string;
  json?: boolean;
}

export function registerPromptsCommand(program: Command): void {
  const prompts = program.command('prompts').description('[internal] Audit and inspect prompt packs');

  prompts
    .command('audit')
    .description('[internal] Audit a prompt pack')
    .argument('<pack>', 'prompt pack name, currently codex-text')
    .option('--root <promptRoot>', 'prompt root directory', './prompts')
    .option('--max-prompt-bytes <bytes>', 'maximum prompt file size', '16000')
    .option('--json', 'print JSON output', false)
    .action(async (pack: string, options: PromptCommandOptions) => {
      if (pack !== 'codex-text') {
        throw new Error(`Unsupported prompt pack: ${pack}`);
      }
      const result = await auditCodexPrompts({
        promptRoot: path.join(options.root ?? './prompts', pack),
        maxPromptBytes: parsePositiveInteger(options.maxPromptBytes ?? '16000', 'maxPromptBytes')
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `promptAudit: ${result.report.ok ? 'pass' : 'fail'}`,
          `promptRoot: ${result.report.promptRoot}`,
          `promptCount: ${result.report.promptCount}`,
          `issues: ${result.report.issues.length}`
        ].join('\n') + '\n'
      );
      if (!result.report.ok) {
        process.exitCode = 1;
      }
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}
