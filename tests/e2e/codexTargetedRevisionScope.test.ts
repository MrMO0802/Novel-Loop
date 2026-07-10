import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { applyTargetedRevisionOperations } from '../../src/app/codexTargetedRevisionScope.js';
import { sha256 } from '../../src/app/codexDiagnosticsEvidenceRules.js';
import { TargetedRevisionPlanSchema } from '../../src/schemas/index.js';
import { AppError } from '../../src/utils/AppError.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetedRevisionProject } from './codexTargetedRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712c-scope-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12C revision scope validation', () => {
  test('blocks an operation that references a paragraph outside the adjudicated targets', async () => {
    const store = new FileStore();
    const { paths } = await prepareTargetedRevisionProject(tempRoot, store);
    const fake = await writeFakeCodex(tempRoot, 'codex-targeted-revision-scope-violation');
    const stateBefore = await store.readText(paths.storyState());
    const queueBefore = await store.readText(paths.chapterQueue());
    const draftBefore = await store.readText(paths.chapterArtifact(1, 'draft_v1.md'));

    await expect(runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      adjudication: 'latest',
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGETED_REVISION_SCOPE_VIOLATION' });

    await expect(store.readText(paths.storyState())).resolves.toBe(stateBefore);
    await expect(store.readText(paths.chapterQueue())).resolves.toBe(queueBefore);
    await expect(store.readText(paths.chapterArtifact(1, 'draft_v1.md'))).resolves.toBe(draftBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v1.md'))).resolves.toBe(false);
  }, 30_000);

  test('deletes only an adjudicated duplicate paragraph and preserves all non-target text', () => {
    const source = '# Chapter\n\nFirst delivery.\n\nDuplicate delivery.\n\nExit scene.';
    const plan = targetedPlan(source, [
      { targetId: 'target_p003', paragraphIndex: 3, text: 'Duplicate delivery.' }
    ], [{
      operationId: 'op_delete_duplicate',
      operationType: 'delete_duplicate_paragraph',
      targetIds: ['target_p003'],
      replacementText: '',
      reason: 'Remove the duplicated delivery event.',
      expectedEffect: 'Only one delivery remains.',
      rulesAddressed: ['duplicate_event_repetition'],
      factsPreserved: ['The first delivery and exit remain unchanged.'],
      newFactsIntroduced: []
    }]);

    const result = applyTargetedRevisionOperations(source, plan);

    expect(result.candidateText).toBe('# Chapter\n\nFirst delivery.\n\nExit scene.');
    expect(result.nonTargetParagraphsUnchanged).toBe(true);
    expect(result.changes).toMatchObject([
      { targetId: 'target_p003', paragraphIndexBefore: 3, paragraphIndexAfter: null, afterText: '' }
    ]);
  });

  test('merges adjudicated paragraphs locally without reordering intervening non-target text', () => {
    const source = '# Chapter\n\nDelivery starts at noon.\n\nProtected middle paragraph.\n\nDelivery closes at 23:29.';
    const plan = targetedPlan(source, [
      { targetId: 'target_p002', paragraphIndex: 2, text: 'Delivery starts at noon.' },
      { targetId: 'target_p004', paragraphIndex: 4, text: 'Delivery closes at 23:29.' }
    ], [{
      operationId: 'op_merge_time',
      operationType: 'merge_target_paragraphs',
      targetIds: ['target_p002', 'target_p004'],
      replacementText: 'The noon delivery starts and closes before the afternoon route.',
      reason: 'Unify the same delivery event under the mission daytime window.',
      expectedEffect: 'The explicit same-event time conflict is removed.',
      rulesAddressed: ['same_event_same_day_explicit_time_conflict'],
      factsPreserved: ['The delivery and protected middle paragraph remain.'],
      newFactsIntroduced: []
    }]);

    const result = applyTargetedRevisionOperations(source, plan);

    expect(result.candidateText).toBe('# Chapter\n\nThe noon delivery starts and closes before the afternoon route.\n\nProtected middle paragraph.\n\n');
    expect(result.nonTargetParagraphsUnchanged).toBe(true);
    expect(result.changes.map((change) => ({
      targetId: change.targetId,
      paragraphIndexBefore: change.paragraphIndexBefore,
      paragraphIndexAfter: change.paragraphIndexAfter
    }))).toEqual([
      { targetId: 'target_p002', paragraphIndexBefore: 2, paragraphIndexAfter: 2 },
      { targetId: 'target_p004', paragraphIndexBefore: 4, paragraphIndexAfter: null }
    ]);
  });
});

function targetedPlan(
  source: string,
  targets: Array<{ targetId: string; paragraphIndex: number; text: string }>,
  operations: Array<{
    operationId: string;
    operationType: 'replace_paragraph' | 'delete_duplicate_paragraph' | 'merge_target_paragraphs';
    targetIds: string[];
    replacementText: string;
    reason: string;
    expectedEffect: string;
    rulesAddressed: string[];
    factsPreserved: string[];
    newFactsIntroduced: string[];
  }>
) {
  return TargetedRevisionPlanSchema.parse({
    planId: 'targeted_revision_plan_test',
    projectId: 'scope-test',
    chapterNumber: 1,
    sourceAdjudicationPath: 'chapters/chapter_001/adjudication.json',
    sourceDraftPath: 'chapters/chapter_001/draft_v1.md',
    sourceDraftHash: sha256(source),
    generatedAt: '2026-07-10T00:00:00.000Z',
    objective: 'Resolve only adjudicated timeline contradictions.',
    allowedTargets: targets.map((target) => ({
      targetId: target.targetId,
      paragraphIndex: target.paragraphIndex,
      originalSnippetHash: sha256(target.text),
      reason: 'Adjudicated target.',
      relatedClaimIds: [],
      relatedContradictionIds: []
    })),
    operations,
    factsToPreserve: ['All non-target paragraphs.'],
    forbiddenChanges: ['No new facts.'],
    expectedResolvedRules: [...new Set(operations.flatMap((operation) => operation.rulesAddressed))],
    storyStateMutated: false
  });
}
