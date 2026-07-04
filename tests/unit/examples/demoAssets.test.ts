import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('demo assets', () => {
  test('provides a reproducible mock demo script with the documented command sequence', async () => {
    const script = await readFile(path.resolve('examples/demo'), 'utf8');

    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('PROJECT_ID="${1:-demo-novel}"');
    for (const command of [
      'corepack pnpm install',
      'corepack pnpm build',
      'corepack pnpm test',
      'corepack pnpm novel-loop init "$PROJECT_ID" --brief "$BRIEF_PATH"',
      'corepack pnpm novel-loop build-bible "$PROJECT_ID" --provider mock',
      'corepack pnpm novel-loop plan-global "$PROJECT_ID" --provider mock',
      'corepack pnpm novel-loop chapter "$PROJECT_ID" 1 --provider mock --max-revisions 2 --commit',
      'corepack pnpm novel-loop inspect "$PROJECT_ID" --debts --reader --characters',
      'corepack pnpm novel-loop validate "$PROJECT_ID"'
    ]) {
      expect(script).toContain(command);
    }
  });

  test('provides a release audit script that cleans and verifies demo artifacts', async () => {
    const script = await readFile(path.resolve('examples/audit'), 'utf8');

    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('rm -rf "$PROJECT_DIR"');
    expect(script).toContain('corepack pnpm novel-loop init "$PROJECT_ID" --brief "$BRIEF_PATH"');
    expect(script).toContain('corepack pnpm novel-loop chapter "$PROJECT_ID" 1 --provider mock --max-revisions 2 --commit');
    expect(script).toContain('require_file "chapters/chapter_001/commit_report.json"');
    expect(script).toContain('require_glob "snapshots/*.json"');
    expect(script).toContain('Release audit complete');
  });

  test('documents mock quickstart commands in README', async () => {
    const readme = await readFile(path.resolve('README.md'), 'utf8');

    expect(readme).toContain('## Quickstart: Mock Demo');
    expect(readme).toContain('pnpm novel-loop init demo-novel --brief ./examples/brief.md');
    expect(readme).toContain('corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md');
    expect(readme).toContain('pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit');
    expect(readme).toContain('The mock demo does not require a real API key.');
  });

  test('declares the pinned package manager in package.json', async () => {
    const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as { packageManager?: unknown };

    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  test('records the v1 mock baseline release in CHANGELOG', async () => {
    const changelog = await readFile(path.resolve('CHANGELOG.md'), 'utf8');

    expect(changelog).toContain('## v1.0.0-mock-baseline');
    expect(changelog).toContain('Deterministic mock demo');
    expect(changelog).toContain('Known limitations');
  });

  test('brief contains enough constraints for the first chapter mock demo', async () => {
    const brief = await readFile(path.resolve('examples/brief.md'), 'utf8');

    expect(brief).toContain('## 读者承诺');
    expect(brief).toContain('## 第一章演示目标');
    expect(brief).toContain('## 状态提交预期');
    expect(brief).toContain('旧收音机');
    expect(brief).toContain('林澈');
  });
});
