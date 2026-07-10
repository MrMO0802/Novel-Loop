import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexTargetedRevisionExperiment } from '../../src/app/codexTargetedRevisionExperiment.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareTargetedRevisionProject } from './codexTargetedRevisionFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712c-audit-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12C targeted revision audit', () => {
  test('strict audit blocks a candidate whose hash no longer matches the scope and A/B report', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareTargetedRevisionProject(tempRoot, store);
    const result = await runCodexTargetedRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);
    await store.writeText(paths.projectArtifact(result.candidateDraftPath), 'tampered candidate\n');

    const audit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(false);
    expect(audit.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'targeted_revision', blocking: true })
    ]));
  }, 45_000);
});
