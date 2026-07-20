import { describe, expect, test } from 'vitest';

import { normalizeTargetedRevisionOperations } from '../../src/app/codexTargetedRevisionOperationNormalizer.js';
import { TargetedRevisionOperationSchema } from '../../src/schemas/index.js';
import { normalizationInput, providerOperation } from './codexTargetedRevisionOperationFixtures.js';

describe('M27.12D2.1 targeted revision operation normalizer', () => {
  test('passes through canonical single-target replace and delete operations', () => {
    const result = normalizeTargetedRevisionOperations(normalizationInput([
      providerOperation('replace_time', 'replace_paragraph', ['target_p033']),
      providerOperation('delete_duplicate', 'delete_duplicate_paragraph', ['target_p019'])
    ]));

    expect(result.report.normalizationSucceeded).toBe(true);
    expect(result.normalizedOperations).toHaveLength(2);
    expect(result.normalizedOperations.every((operation) => TargetedRevisionOperationSchema.safeParse(operation).success)).toBe(true);
    expect(result.normalizedOperations.map((operation) => operation.normalizationMode)).toEqual(['passthrough', 'passthrough']);
  });

  test('atomically splits a same-sequence multi-target delete with parent provenance', () => {
    const result = normalizeTargetedRevisionOperations(normalizationInput([
      providerOperation('delete_duplicate_sequence', 'delete_duplicate_paragraph', ['target_p019', 'target_p020'])
    ]));

    expect(result.report.normalizationSucceeded).toBe(true);
    expect(result.report.semanticChangesIntroduced).toBe(false);
    expect(result.normalizedOperations).toHaveLength(2);
    expect(result.normalizedOperations.every((operation) => operation.targetIds.length === 1)).toBe(true);
    expect(result.normalizedOperations.every((operation) => operation.parentOperationId === 'delete_duplicate_sequence')).toBe(true);
    expect(result.normalizedOperations.every((operation) => operation.sourceOperationId === 'delete_duplicate_sequence')).toBe(true);
    expect(result.normalizedOperations.every((operation) => operation.normalizationMode === 'atomic_split')).toBe(true);
    expect(result.normalizedOperations.every((operation) => TargetedRevisionOperationSchema.safeParse(operation).success)).toBe(true);
    expect(result.report.operations[0]).toMatchObject({
      sourceOperationId: 'delete_duplicate_sequence',
      sourceTargetIds: ['target_p019', 'target_p020'],
      normalizedTargetIds: ['target_p019', 'target_p020'],
      normalizationMode: 'atomic_split',
      semanticEquivalenceConfirmed: true,
      approvedTargetCheckPassed: true,
      allowedOperationCheckPassed: true,
      sequenceIdentityCheckPassed: true
    });
  });

  test.each([
    {
      name: 'unapproved target',
      operation: providerOperation('unapproved', 'delete_duplicate_paragraph', ['target_p019', 'target_unknown']),
      code: 'CODEX_TARGETED_REVISION_OPERATION_TARGET_NOT_APPROVED'
    },
    {
      name: 'cross-event delete',
      operation: providerOperation('cross_event', 'delete_duplicate_paragraph', ['target_p019', 'target_p040']),
      code: 'CODEX_TARGETED_REVISION_SEQUENCE_IDENTITY_MISMATCH'
    },
    {
      name: 'multi-target replace',
      operation: providerOperation('multi_replace', 'replace_paragraph', ['target_p019', 'target_p020']),
      code: 'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH'
    },
    {
      name: 'single-target merge',
      operation: providerOperation('single_merge', 'merge_target_paragraphs', ['target_p019']),
      code: 'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH'
    },
    {
      name: 'duplicate target ids',
      operation: providerOperation('duplicate_ids', 'delete_duplicate_paragraph', ['target_p019', 'target_p019']),
      code: 'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE'
    },
    {
      name: 'new facts',
      operation: providerOperation('new_facts', 'replace_paragraph', ['target_p019'], { newFactsIntroduced: ['A new order exists.'] }),
      code: 'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH'
    },
    {
      name: 'delete replacement text',
      operation: providerOperation('delete_with_replacement', 'delete_duplicate_paragraph', ['target_p019'], { replacementText: 'Not a deletion.' }),
      code: 'CODEX_TARGETED_REVISION_DELETE_CARDINALITY_INVALID'
    },
    {
      name: 'operation type not allowed',
      operation: providerOperation('delete_time', 'delete_duplicate_paragraph', ['target_p033']),
      code: 'CODEX_TARGETED_REVISION_OPERATION_TYPE_NOT_ALLOWED'
    }
  ])('rejects $name with a precise contract code', ({ operation, code }) => {
    const result = normalizeTargetedRevisionOperations(normalizationInput([operation]));

    expect(result.report.normalizationSucceeded).toBe(false);
    expect(result.normalizedOperations).toEqual([]);
    expect(result.report.rejectedOperations[0]?.errorCode).toBe(code);
    expect(result.failure?.code).toBe(code);
    expect(result.report.storyStateMutated).toBe(false);
  });

  test('preserves a valid multi-target merge without splitting it', () => {
    const result = normalizeTargetedRevisionOperations(normalizationInput([
      providerOperation('merge_sequence', 'merge_target_paragraphs', ['target_p019', 'target_p020'])
    ]));

    expect(result.report.normalizationSucceeded).toBe(true);
    expect(result.normalizedOperations).toHaveLength(1);
    expect(result.normalizedOperations[0]).toMatchObject({
      operationType: 'merge_target_paragraphs',
      targetIds: ['target_p019', 'target_p020'],
      normalizationMode: 'passthrough'
    });
  });
});
