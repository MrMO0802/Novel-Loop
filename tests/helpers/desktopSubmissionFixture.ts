import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBible } from '../../src/app/buildBible.js';
import { adoptAuthorRevision, createAuthorRevision } from '../../src/app/chapterAuthorRevision.js';
import { runChapterUntilDraft } from '../../src/app/chapterDrafting.js';
import { runChapterDryRun } from '../../src/app/chapterPlanning.js';
import { initProjectFromBriefText } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from './fakeCodex.js';

export async function createDesktopSubmissionFixture() {
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-desktop-submission-'));
  const cleanup = () => rm(projectsRoot, { recursive: true, force: true });
  try {
    const projectId = 'desktop-submission-test';
    const chapterNumber = 1;
    const paths = new ProjectPaths(projectsRoot, projectId);
    const fake = await writeFakeCodex(projectsRoot, 'codex-controlled-valid');
    const generationInput = {
      projectId, projectsRoot, provider: 'codex-text' as const,
      promptRoot: fileURLToPath(new URL('../../prompts/', import.meta.url)),
      codexBin: fake.codexBin, codexProfile: 'clean' as const
    };
    await initProjectFromBriefText({
      projectId, projectsRoot,
      brief: '# Submission Fixture\n\nAn impossible radio signal leads to an abandoned building.\n'
    });
    // Generation also reads repository prompt templates, outside the temporary project.
    const store = new FileStore();
    await buildBible(generationInput, store);
    await planGlobal(generationInput, store);
    await runChapterDryRun({ ...generationInput, chapterNumber }, store);
    await runChapterUntilDraft({ ...generationInput, chapterNumber }, store);
    const originalText = await store.readText(paths.chapterArtifact(chapterNumber, 'draft_v1.md'));
    const adoptedText = `${originalText}\nDESKTOP_SUBMISSION_ADOPTED_B: The witness kept the blue receipt.\n`;
    const revision = await createAuthorRevision({
      projectRoot: paths.projectRoot, chapterNumber,
      artifactKind: 'draft', mode: 'direct_edit',
      sourceArtifactPath: paths.chapterArtifact(chapterNumber, 'draft_v1.md'),
      sourceCandidateId: null, content: adoptedText, authorInstruction: null
    }, store);
    const adoptedRevision = await adoptAuthorRevision({
      projectRoot: paths.projectRoot, chapterNumber, revisionId: revision.record.revisionId
    }, store);
    return {
      projectsRoot, projectRoot: paths.projectRoot, projectId, chapterNumber,
      paths, store, fake, codexBin: fake.codexBin, generationInput,
      originalText, adoptedText, revisionId: adoptedRevision.revisionId,
      adoptedRevision, revisionRecordPath: revision.relativeRecordPath,
      adoptedDraftPath: revision.relativeMarkdownPath, cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export type DesktopSubmissionFixture = Awaited<ReturnType<typeof createDesktopSubmissionFixture>>;
