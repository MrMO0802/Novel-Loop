#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const checklistPath = path.resolve('docs/release/M20_RELEASE_CHECKLIST.md');
process.stdout.write(await readFile(checklistPath, 'utf8'));
