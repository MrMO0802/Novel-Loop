import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { approveCodexRevisionCandidate, reviewCodexRevisionCandidate } from '../../src/app/codexRevisionCandidateAdoption.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { AppError } from '../../src/utils/AppError.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { prepareRevisionCandidateProject } from './codexRevisionCandidateFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d3-approval-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D3 candidate adoption approval', () => {
  test('records explicit preview-only approval without Codex, queue, or Story State mutation', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareRevisionCandidateProject(tempRoot, store);
    await reviewCodexRevisionCandidate({ projectId: paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest' }, store);
    const before = await Promise.all([store.readText(paths.storyState()), store.readText(paths.chapterQueue()), store.readText(fake.argsLogPath)]);

    const result = await approveCodexRevisionCandidate({
      projectId: paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest',
      confirm: true,
      operator: 'd3-test'
    }, store);

    expect(result.record.approved).toBe(true);
    expect(result.record.approvalScope).toBe('preview_only');
    expect(result.record.riskAcknowledged).toBe(true);
    expect(await Promise.all([store.readText(paths.storyState()), store.readText(paths.chapterQueue()), store.readText(fake.argsLogPath)])).toEqual(before);
    await expect(store.exists(paths.chapterArtifact(1, 'draft_v2.md'))).resolves.toBe(false);
  }, 60_000);

  test('rejects stale and non-effective candidates', async () => {
    const store = new FileStore();
    const stale = await prepareRevisionCandidateProject(tempRoot, store);
    await reviewCodexRevisionCandidate({ projectId: stale.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest' }, store);
    await store.writeText(stale.paths.projectArtifact(stale.experiment.candidateDraftPath), `${await store.readText(stale.paths.projectArtifact(stale.experiment.candidateDraftPath))}\nmanual edit\n`);
    await expect(approveCodexRevisionCandidate({
      projectId: stale.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest',
      confirm: true
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_CANDIDATE_STALE' });

    await removeTempRoot(tempRoot);
    tempRoot = await createTempRoot('novel-loop-m2712d3-ineligible-');
    const ineligible = await prepareRevisionCandidateProject(tempRoot, store, 'codex-expanded-target-quality-regression');
    await reviewCodexRevisionCandidate({ projectId: ineligible.paths.projectId, projectsRoot: tempRoot, chapterNumber: 1, candidate: 'latest' }, store);
    await expect(approveCodexRevisionCandidate({
      projectId: ineligible.paths.projectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      candidate: 'latest',
      confirm: true
    }, store)).rejects.toMatchObject<AppError>({ code: 'CODEX_REVISION_CANDIDATE_NOT_ELIGIBLE' });
  }, 120_000);
});
