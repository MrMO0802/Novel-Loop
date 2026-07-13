import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { ExpandedTargetRevisionCandidateDispositionSchema, ExpandedTargetRevisionScopeValidationSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-scope-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 expanded target scope', () => {
  test('handles every required target while preserving non-target paragraphs', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const result = await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);
    const scope = await store.readJson(paths.projectArtifact(result.scopeValidationPath), ExpandedTargetRevisionScopeValidationSchema);

    expect(scope.scopeValid).toBe(true);
    expect(scope.coverageResolved).toBe(true);
    expect(scope.fullApprovedTargetSetMatched).toBe(true);
    expect(scope.requiredTargetsHandled).toBe(true);
    expect(scope.nonTargetParagraphsUnchanged).toBe(true);
    expect(scope.residualTimeReferences).toEqual([]);
    expect(scope.residualDuplicateSequenceFragments).toEqual([]);
    expect(scope.totalChangedParagraphCount).toBeGreaterThan(0);
    expect(scope.changeRatio).toBeGreaterThan(0);
  }, 45_000);

  test('blocks when Codex omits any required closure target', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store, 'codex-expanded-target-incomplete');

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGETED_REVISION_INCOMPLETE_TARGET_COVERAGE' });

    await expect(store.exists(paths.chapterArtifact(1, 'draft_targeted_revision_candidate_v2.md'))).resolves.toBe(false);
  }, 45_000);

  test.each([
    ['codex-expanded-target-residual-time', 'residualTimeReferences'],
    ['codex-expanded-target-residual-duplicate', 'residualDuplicateSequenceFragments']
  ] as const)('detects unresolved %s evidence locally', async (fakeMode, field) => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store, fakeMode);

    await expect(runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_TARGETED_REVISION_SCOPE_VIOLATION' });

    const scope = await store.readJson(paths.chapterArtifact(1, 'targeted_revision_scope_validation_v2.json'), ExpandedTargetRevisionScopeValidationSchema);
    const disposition = await store.readJson(paths.chapterArtifact(1, 'targeted_revision_candidate_disposition_v2.json'), ExpandedTargetRevisionCandidateDispositionSchema);
    expect(scope[field].length).toBeGreaterThan(0);
    expect(scope.scopeValid).toBe(false);
    expect(disposition.result).toBe('rejected_scope_violation');
    expect(disposition.adopted).toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'targeted_revision_diagnostics_ab_v2.json'))).resolves.toBe(false);
  }, 45_000);
});
