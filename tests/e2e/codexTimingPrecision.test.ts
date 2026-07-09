import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { execCodexJson } from '../../src/app/codexBoundary.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, projectId, removeTempRoot } from './m16Helpers.js';

const REQUIRED_TIMING_EVENTS = [
  'CODEX_PROCESS_SPAWN_STARTED',
  'CODEX_PROCESS_SPAWNED',
  'CODEX_STDIN_WRITTEN',
  'CODEX_FIRST_JSONL_EVENT',
  'CODEX_FINAL_MESSAGE_SEEN',
  'CODEX_PROCESS_EXITED',
  'CODEX_ARTIFACT_WRITE_STARTED',
  'CODEX_ARTIFACT_WRITE_COMPLETED',
  'CODEX_PARSE_STARTED',
  'CODEX_PARSE_COMPLETED',
  'CODEX_SCHEMA_VALIDATE_STARTED',
  'CODEX_SCHEMA_VALIDATE_COMPLETED'
];

describe('M27.8A Codex timing precision', () => {
  test('writes fine-grained Codex timing events without leaking prompt or auth data', async () => {
    const tempRoot = await createTempRoot('novel-loop-m278a-timing-');
    try {
      const fake = await writeFakeCodex(tempRoot, 'valid');
      const promptPath = path.join(tempRoot, 'prompt.md');
      const schemaPath = path.join(tempRoot, 'schema.json');
      await writeFile(promptPath, 'Return the structured payload.\n', 'utf8');
      await writeFile(
        schemaPath,
        JSON.stringify({
          type: 'object',
          required: ['title', 'ok'],
          properties: {
            title: { type: 'string' },
            ok: { type: 'boolean' }
          }
        }),
        'utf8'
      );

      const result = await execCodexJson({
        codexBin: fake.codexBin,
        projectsRoot: tempRoot,
        projectId,
        promptPath,
        schemaPath,
        runId: 'run_m278a_codex_json'
      });

      const paths = new ProjectPaths(tempRoot, projectId);
      const store = new FileStore();
      const events = parseEvents(await store.readText(paths.runEvents(result.runId)));
      const eventTypes = events.map((event) => event.eventType);

      for (const eventType of REQUIRED_TIMING_EVENTS) {
        expect(eventTypes).toContain(eventType);
      }
      expectEventOrder(events, [
        'CODEX_PROCESS_SPAWN_STARTED',
        'CODEX_PROCESS_SPAWNED',
        'CODEX_STDIN_WRITTEN',
        'CODEX_FIRST_JSONL_EVENT',
        'CODEX_FINAL_MESSAGE_SEEN',
        'CODEX_PROCESS_EXITED'
      ]);
      expectEventOrder(events, ['CODEX_PARSE_STARTED', 'CODEX_PARSE_COMPLETED']);
      expectEventOrder(events, ['CODEX_SCHEMA_VALIDATE_STARTED', 'CODEX_SCHEMA_VALIDATE_COMPLETED']);
      expectEventOrder(events, ['CODEX_ARTIFACT_WRITE_STARTED', 'CODEX_ARTIFACT_WRITE_COMPLETED']);

      for (const event of events.filter((event) => event.eventType.startsWith('CODEX_'))) {
        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain('sk-SECRET');
        expect(serialized).not.toContain('auth.json');
        expect(serialized).not.toContain('Return the structured payload');
      }
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

function parseEvents(text: string): Array<{ eventType: string; timestamp: string }> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { eventType: string; timestamp: string });
}

function expectEventOrder(events: Array<{ eventType: string; timestamp: string }>, expectedTypes: string[]): void {
  const selected = expectedTypes.map((eventType) => {
    const event = events.find((candidate) => candidate.eventType === eventType);
    expect(event).toBeDefined();
    return Date.parse(event!.timestamp);
  });
  for (let index = 1; index < selected.length; index += 1) {
    expect(selected[index]!).toBeGreaterThanOrEqual(selected[index - 1]!);
  }
}
