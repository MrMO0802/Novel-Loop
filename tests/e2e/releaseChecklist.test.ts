import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { createProgram } from '../../src/cli/program.js';

describe('M20 release checklist and maintenance commands', () => {
  test('registers release hardening commands in CLI help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    for (const commandName of ['stress-fixture', 'retention', 'compact-provenance']) {
      expect(help).toContain(commandName);
    }
    expect(program.commands.find((command) => command.name() === 'retention')?.helpInformation()).toContain('--apply');
    expect(program.commands.find((command) => command.name() === 'compact-provenance')?.helpInformation()).toContain('--max-events-per-run');
  });

  test('package scripts expose clean targets and release checklist', async () => {
    const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.['clean:demo']).toBe('node scripts/clean-generated.mjs demo');
    expect(pkg.scripts?.['clean:test']).toBe('node scripts/clean-generated.mjs test');
    expect(pkg.scripts?.['clean:generated']).toBe('node scripts/clean-generated.mjs generated');
    expect(pkg.scripts?.['release:checklist']).toBe('node scripts/print-release-checklist.mjs');
  });

  test('release checklist documents required release candidate verification commands', async () => {
    const checklist = await readFile(path.resolve('docs/release/M20_RELEASE_CHECKLIST.md'), 'utf8');
    const readme = await readFile(path.resolve('README.md'), 'utf8');
    const changelog = await readFile(path.resolve('CHANGELOG.md'), 'utf8');
    const cleanScript = await readFile(path.resolve('scripts/clean-generated.mjs'), 'utf8');
    const checklistScript = await readFile(path.resolve('scripts/print-release-checklist.mjs'), 'utf8');

    for (const command of [
      'corepack pnpm build',
      'corepack pnpm test',
      'corepack pnpm novel-loop audit demo-novel --strict',
      'corepack pnpm novel-loop artifacts demo-novel --refresh',
      'corepack pnpm novel-loop runs demo-novel',
      'corepack pnpm novel-loop verify-snapshots demo-novel'
    ]) {
      expect(checklist).toContain(command);
      expect(readme).toContain(command);
    }
    expect(changelog).toContain('## v1.8.0-release-hardening-mock');
    expect(readme).toContain('## Release Candidate Usage');
    expect(cleanScript).toContain('clean-generated');
    expect(checklistScript).toContain('M20_RELEASE_CHECKLIST.md');
  });
});
