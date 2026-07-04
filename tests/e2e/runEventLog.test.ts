import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareCommittedChapterOne, readEvents } from './m19Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m19-events-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('run event log', () => {
  test('events.ndjson is append-only ordered timeline for a chapter commit run', async () => {
    const paths = await prepareCommittedChapterOne(tempRoot);
    const events = await readEvents(paths, 'run_m19_ch1_revision');
    const eventTypes = events.map((event) => event.eventType);

    expect(eventTypes[0]).toBe('RUN_STARTED');
    expect(eventTypes.at(-1)).toBe('RUN_COMPLETED');
    expect(eventTypes).toEqual(expect.arrayContaining([
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'PROMPT_CALL_STARTED',
      'PROMPT_CALL_COMPLETED',
      'ARTIFACT_GENERATED',
      'ARTIFACT_VALIDATED',
      'QUEUE_TRANSITION',
      'STATE_MUTATION_APPLIED',
      'SNAPSHOT_CREATED'
    ]));

    const runStartedIndex = eventTypes.indexOf('RUN_STARTED');
    const firstStageIndex = eventTypes.indexOf('STAGE_STARTED');
    const stateMutationIndex = eventTypes.indexOf('STATE_MUTATION_APPLIED');
    const runCompletedIndex = eventTypes.indexOf('RUN_COMPLETED');
    expect(runStartedIndex).toBeLessThan(firstStageIndex);
    expect(firstStageIndex).toBeLessThan(stateMutationIndex);
    expect(stateMutationIndex).toBeLessThan(runCompletedIndex);

    for (const event of events) {
      expect(event.runId).toBe('run_m19_ch1_revision');
      expect(event.projectId).toBe(paths.projectId);
      expect(typeof event.eventId).toBe('string');
      expect(typeof event.timestamp).toBe('string');
      expect(['info', 'warning', 'error', 'critical']).toContain(event.severity);
      expect(event.payload).toBeTypeOf('object');
    }
  });
});
