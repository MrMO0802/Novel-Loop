#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = [
  'dist/cli/index.js',
  'codex',
  'single-chapter-smoke',
  '--project-id',
  process.env.NLE_CODEX_SINGLE_PROJECT_ID ?? 'codex-single',
  '--brief',
  process.env.NLE_CODEX_SINGLE_BRIEF ?? './examples/brief.md'
];

if (process.env.NLE_CODEX_BIN !== undefined && process.env.NLE_CODEX_BIN.length > 0) {
  args.push('--codex-bin', process.env.NLE_CODEX_BIN);
}

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
