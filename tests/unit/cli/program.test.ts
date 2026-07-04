import { describe, expect, test } from 'vitest';

import { createProgram } from '../../../src/cli/program.js';

describe('CLI program', () => {
  test('prints help for novel-loop without invoking business logic', () => {
    const program = createProgram();

    expect(program.name()).toBe('novel-loop');
    expect(program.description()).toContain('Novel Loop Engine');
    expect(program.helpInformation()).toContain('Usage: novel-loop');
    expect(program.helpInformation()).toContain('init');
    expect(program.helpInformation()).toContain('validate');
    expect(program.helpInformation()).toContain('build-bible');
    expect(program.helpInformation()).toContain('plan-global');
    expect(program.helpInformation()).toContain('providers');
    expect(program.helpInformation()).toContain('chapter');
    expect(program.helpInformation()).toContain('inspect');
    expect(program.helpInformation()).toContain('rollback');
    expect(program.helpInformation()).toContain('commit-chapter');
    expect(program.helpInformation()).toContain('review');
    expect(program.helpInformation()).toContain('diff-state');
    expect(program.helpInformation()).toContain('recommit');
    expect(program.helpInformation()).toContain('stale');
    expect(program.helpInformation()).toContain('regeneration-plan');
    expect(program.helpInformation()).toContain('artifacts');
    expect(program.helpInformation()).toContain('runs');
    expect(program.helpInformation()).toContain('run');
    expect(program.helpInformation()).toContain('snapshots');
    expect(program.helpInformation()).toContain('snapshot');
    expect(program.helpInformation()).toContain('verify-snapshots');
    expect(program.helpInformation()).toContain('audit');
    expect(program.helpInformation()).toContain('stress-fixture');
    expect(program.helpInformation()).toContain('retention');
    expect(program.helpInformation()).toContain('compact-provenance');
    expect(program.helpInformation()).toContain('codex');
  });

  test('documents chapter draft mode in command help', () => {
    const program = createProgram();
    const chapterCommand = program.commands.find((command) => command.name() === 'chapter');

    expect(chapterCommand?.helpInformation()).toContain('--until <stage>');
    expect(chapterCommand?.helpInformation()).toContain('--max-revisions <count>');
    expect(chapterCommand?.helpInformation()).toContain('--commit');
    expect(chapterCommand?.helpInformation()).toContain('--dry-run');
  });

  test('uses consistent provider and root option help text', () => {
    const program = createProgram();
    const providerBackedCommands = ['build-bible', 'plan-global', 'chapter', 'commit-chapter'];

    for (const commandName of providerBackedCommands) {
      const command = program.commands.find((candidate) => candidate.name() === commandName);
      const help = command?.helpInformation() ?? '';
      expect(help.replace(/\s+/g, ' ')).toContain('LLM provider to use: mock, codex-text, real, or openai');
      expect(help).toContain('projects root directory');
    }
  });

  test('keeps command help descriptions aligned with demo workflow stages', () => {
    const program = createProgram();

    expect(program.commands.find((command) => command.name() === 'build-bible')?.description()).toBe('Generate strategy artifacts from project brief');
    expect(program.commands.find((command) => command.name() === 'plan-global')?.description()).toBe('Generate global planning artifacts from strategy');
    expect(program.commands.find((command) => command.name() === 'providers')?.description()).toBe('List and inspect LLM providers');
    expect(program.commands.find((command) => command.name() === 'chapter')?.description()).toBe('Run chapter planning, drafting, revision, and optional commit');
    expect(program.commands.find((command) => command.name() === 'commit-chapter')?.description()).toBe('Commit an existing final.md into Story State');
    expect(program.commands.find((command) => command.name() === 'review')?.description()).toBe('Review chapter status and manual intervention context');
    expect(program.commands.find((command) => command.name() === 'diff-state')?.description()).toBe('Generate Story State diff artifacts');
    expect(program.commands.find((command) => command.name() === 'recommit')?.description()).toBe('Controlled manual recommit from final.md or canon patch');
    expect(program.commands.find((command) => command.name() === 'stale')?.description()).toBe('Inspect chapters invalidated by historical recommit');
    expect(program.commands.find((command) => command.name() === 'regeneration-plan')?.description()).toBe('Generate a downstream regeneration plan for stale chapters');
    expect(program.commands.find((command) => command.name() === 'artifacts')?.description()).toBe('Browse and refresh project artifact index');
    expect(program.commands.find((command) => command.name() === 'runs')?.description()).toBe('List project run manifests');
    expect(program.commands.find((command) => command.name() === 'run')?.description()).toBe('Inspect one project run manifest');
    expect(program.commands.find((command) => command.name() === 'snapshots')?.description()).toBe('List Story State snapshots');
    expect(program.commands.find((command) => command.name() === 'snapshot')?.description()).toBe('Inspect one Story State snapshot');
    expect(program.commands.find((command) => command.name() === 'verify-snapshots')?.description()).toBe('Verify Story State snapshots');
    expect(program.commands.find((command) => command.name() === 'audit')?.description()).toBe('Run project audit checks');
    expect(program.commands.find((command) => command.name() === 'stress-fixture')?.description()).toBe('Create a deterministic long-project stress fixture');
    expect(program.commands.find((command) => command.name() === 'retention')?.description()).toBe('Preview or apply run and archive retention policy');
    expect(program.commands.find((command) => command.name() === 'compact-provenance')?.description()).toBe('Compact oversized run event logs while preserving summary provenance');
    expect(program.commands.find((command) => command.name() === 'codex')?.description()).toBe('Run local Codex CLI within a read-only execution boundary');
  });

  test('documents manual review and recommit command options', () => {
    const program = createProgram();

    expect(program.commands.find((command) => command.name() === 'review')?.helpInformation()).toContain('--suggest-next');
    expect(program.commands.find((command) => command.name() === 'diff-state')?.helpInformation()).toContain('--patch <canonPatchPath>');
    expect(program.commands.find((command) => command.name() === 'recommit')?.helpInformation()).toContain('--from-final');
    expect(program.commands.find((command) => command.name() === 'recommit')?.helpInformation()).toContain('--confirm');
    expect(program.commands.find((command) => command.name() === 'stale')?.helpInformation()).toContain('--json');
    expect(program.commands.find((command) => command.name() === 'regeneration-plan')?.helpInformation()).toContain('--from <chapterNumber>');
    expect(program.commands.find((command) => command.name() === 'chapter')?.helpInformation()).toContain('--regenerate-stale');
    expect(program.commands.find((command) => command.name() === 'chapter')?.helpInformation()).toContain('--reuse-policy <policy>');
    expect(program.commands.find((command) => command.name() === 'artifacts')?.helpInformation()).toContain('--refresh');
    expect(program.commands.find((command) => command.name() === 'runs')?.helpInformation()).toContain('--limit <count>');
    expect(program.commands.find((command) => command.name() === 'snapshots')?.helpInformation()).toContain('--kind <kind>');
    expect(program.commands.find((command) => command.name() === 'audit')?.helpInformation()).toContain('--strict');
    expect(program.commands.find((command) => command.name() === 'audit')?.helpInformation()).toContain('--fix-index');
    expect(program.commands.find((command) => command.name() === 'retention')?.helpInformation()).toContain('--apply');
    expect(program.commands.find((command) => command.name() === 'compact-provenance')?.helpInformation()).toContain('--max-events-per-run');
    expect(program.commands.find((command) => command.name() === 'codex')?.helpInformation()).toContain('exec-json');
  });
});
