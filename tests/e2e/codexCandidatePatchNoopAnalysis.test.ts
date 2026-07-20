import { describe, expect, test } from 'vitest';

import { analyzeCandidatePatchMutationNoop } from '../../src/app/codexCandidateCommitDecision.js';
import { CandidateCommitMutationDecisionSchema } from '../../src/schemas/index.js';

describe('M27.12D4A.1 candidate patch no-op analysis', () => {
  test('detects an open-to-open maintain operation whose payload is ignored by the state applier', () => {
    const analysis = analyzeCandidatePatchMutationNoop({
      mutationId: 'mutation_012',
      statePath: '/narrativeDebts/ch001_debt_003',
      mutationType: 'narrative_debt',
      beforeValue: {
        id: 'ch001_debt_003',
        status: 'open',
        payoffHistory: []
      },
      afterValue: {
        debtId: 'ch001_debt_003',
        action: 'maintain',
        payload: { text: 'The chapter repeats the unresolved clue.' }
      }
    });

    expect(analysis).toMatchObject({
      semanticNoop: true,
      metadataChanged: false,
      changedFields: [],
      recommendation: 'remove-required'
    });
  });

  test('does not classify a maintained debt with consumed metadata as a no-op', () => {
    const analysis = analyzeCandidatePatchMutationNoop({
      mutationId: 'mutation_012',
      statePath: '/narrativeDebts/ch001_debt_003',
      mutationType: 'narrative_debt',
      beforeValue: { id: 'ch001_debt_003', status: 'open', payoffHistory: [] },
      afterValue: {
        debtId: 'ch001_debt_003',
        action: 'maintain',
        payload: { payoffTargetChapter: 6 }
      }
    });
    expect(analysis.semanticNoop).toBe(false);
    expect(analysis.metadataChanged).toBe(true);
    expect(analysis.changedFields).toEqual(['payoffTargetChapter']);
  });

  test('schema rejects direct approval of a semantic no-op', () => {
    const hash = 'a'.repeat(64);
    const parsed = CandidateCommitMutationDecisionSchema.safeParse({
      decisionId: 'decision_noop',
      projectId: 'demo-novel',
      chapterNumber: 2,
      commitReviewPath: 'chapters/chapter_002/candidate_commit_review_v1.json',
      mutationId: 'mutation_012',
      statePath: '/narrativeDebts/ch001_debt_003',
      mutationType: 'narrative_debt',
      mutationOrigin: 'narrative_state',
      decision: 'approve',
      note: 'This must be rejected by schema.',
      operator: 'local_user',
      decidedAt: '2026-07-20T00:00:00.000Z',
      evidenceMapPath: 'chapters/chapter_002/candidate_patch_evidence_map_v1.json',
      sourceStateHash: hash,
      sourceQueueHash: hash,
      sourceFinalHash: hash,
      sourcePatchHash: hash,
      sourceDiffHash: hash,
      supersedesDecisionId: null,
      active: true,
      semanticNoop: true,
      narrativeDebtAssessment: null,
      storyStateMutated: false,
      queueMutated: false
    });
    expect(parsed.success).toBe(false);
  });
});
