#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const forwarded = process.argv.slice(2).filter((arg) => arg !== '--');
const hasProjectId = forwarded.includes('--project-id');
const hasBrief = forwarded.includes('--brief');
const hasChapters = forwarded.includes('--chapters');
const args = [
  'dist/cli/index.js',
  'codex',
  'multi-chapter-pilot',
  ...(hasProjectId ? [] : ['--project-id', 'codex-multi']),
  ...(hasBrief ? [] : ['--brief', './examples/brief.md']),
  ...(hasChapters ? [] : ['--chapters', '3']),
  '--codex-profile',
  'clean',
  '--codex-json-retries',
  '2',
  '--codex-json-repair',
  ...forwarded
];

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
