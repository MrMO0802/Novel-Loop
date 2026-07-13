import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { auditProject } from '../../src/app/projectAudit.js';
import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { reviewChapter } from '../../src/app/reviewChapter.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d2-review-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2 review and audit integration', () => {
  test('shows v2 provenance and strict-audits the isolated experiment without canonical mutation', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store);
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json')),
      store.readText(paths.chapterArtifact(1, 'mission.json')),
      store.readText(paths.chapterArtifact(1, 'selected_plan.md'))
    ]);
    await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 3,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);

    const review = await reviewChapter({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      diagnostics: true,
      artifacts: true,
      suggestNext: true
    }, store);
    expect(review).toContain('Candidate v2 disposition');
    expect(review).toContain('accepted_for_preview_review');
    expect(review).toContain('Target operation coverage');
    expect(review).toContain('no_remaining_contradiction');
    expect(review).toContain('human review');

    const audit = await auditProject({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      strict: true,
      fixIndex: true
    }, store);
    expect(audit.ok, JSON.stringify(audit.report.issues, null, 2)).toBe(true);
    expect(audit.report.issues.filter((issue) => issue.severity === 'error' || issue.severity === 'critical')).toEqual([]);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md')),
      store.readText(paths.chapterArtifact(1, 'diagnostics_v1.json')),
      store.readText(paths.chapterArtifact(1, 'mission.json')),
      store.readText(paths.chapterArtifact(1, 'selected_plan.md'))
    ])).toEqual(protectedBefore);
    await expect(store.exists(paths.chapterArtifact(1, 'canon_patch.json'))).resolves.toBe(false);
    await expect(store.exists(paths.chapterArtifact(1, 'commit_report.json'))).resolves.toBe(false);
  }, 60_000);
});
