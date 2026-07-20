import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  adoptCodexRevisionCandidate,
  approveCodexRevisionCandidate,
  reviewCodexRevisionCandidate
} from '../../src/app/codexRevisionCandidateAdoption.js';
import { DraftAdoptionManifestSchema, DraftSelectionSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-adoption-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 candidate draft adoption', () => {
  test('copies the approved candidate to draft_v2 with complete provenance and no canonical mutation', async () => {
    const store = new FileStore();
    const { paths, experiment } = await prepareRevisionCandidateProject(tempRoot, store);
    await reviewCodexRevisionCandidate({ projectId: paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest' }, store);
    await approveCodexRevisionCandidate({ projectId: paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest', confirm: true }, store);
    const candidate = await store.readText(paths.projectArtifact(experiment.candidateDraftPath));
    const before = await Promise.all([store.readText(paths.storyState()), store.readText(paths.chapterQueue()), store.readText(paths.chapterArtifact(1, 'draft_v1.md'))]);

    const result = await adoptCodexRevisionCandidate({
      projectId: paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest',
      approval: 'latest'
    }, store);

    await expect(store.readText(paths.chapterArtifact(1, 'draft_v2.md'))).resolves.toBe(candidate);
    const manifest = await store.readJson(paths.projectArtifact(result.manifestPath), DraftAdoptionManifestSchema);
    const selection = await store.readJson(paths.projectArtifact(result.selectionPath), DraftSelectionSchema);
    expect(manifest.canonical).toBe(false);
    expect(manifest.storyStateMutated).toBe(false);
    expect(manifest.queueCommitted).toBe(false);
    expect(selection.selectedDraftPath).toBe('chapters/chapter_001/draft_v2.md');
    expect(selection.scope).toBe('preview_only');
    expect(await Promise.all([store.readText(paths.storyState()), store.readText(paths.chapterQueue()), store.readText(paths.chapterArtifact(1, 'draft_v1.md'))])).toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
  }, 60_000);

  test('rejects adoption when the approved review provenance changes', async () => {
    const store = new FileStore();
    const { paths } = await prepareRevisionCandidateProject(tempRoot, store);
    const review = await reviewCodexRevisionCandidate({ projectId: paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest' }, store);
    await approveCodexRevisionCandidate({ projectId: paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest', confirm: true }, store);
    await store.writeText(paths.projectArtifact(review.reportPath), `${await store.readText(paths.projectArtifact(review.reportPath))}\n`);

    await expect(adoptCodexRevisionCandidate({
      projectId: paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest',
      approval: 'latest'
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_CANDIDATE_STALE' });
    await expect(store.exists(paths.chapterArtifact(1, 'draft_v2.md'))).resolves.toBe(false);
  }, 60_000);
});
