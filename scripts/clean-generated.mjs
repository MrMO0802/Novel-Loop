#!/usr/bin/env node
import { rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2] ?? 'generated';
const repoRoot = process.cwd();

async function removeIfExists(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
  process.stdout.write(`removed: ${targetPath}\n`);
}

async function cleanDemo() {
  await removeIfExists(path.join(repoRoot, 'projects', 'demo-novel'));
}

async function cleanTest() {
  const tempRoot = os.tmpdir();
  for (const entry of await readdir(tempRoot)) {
    if (entry.startsWith('novel-loop-')) {
      await removeIfExists(path.join(tempRoot, entry));
    }
  }
}

async function cleanGenerated() {
  await cleanDemo();
  await removeIfExists(path.join(repoRoot, 'projects', 'stress-fixture'));
}

switch (target) {
  case 'demo':
    await cleanDemo();
    break;
  case 'test':
    await cleanTest();
    break;
  case 'generated':
    await cleanGenerated();
    break;
  default:
    process.stderr.write('Usage: clean-generated <demo|test|generated>\n');
    process.exitCode = 2;
}
