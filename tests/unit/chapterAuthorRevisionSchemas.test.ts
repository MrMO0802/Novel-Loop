import { describe, expect, test } from 'vitest';

import {
  AuthorRevisionAdoptionJournalSchema,
  AuthorEditInvalidationReportSchema,
  AuthorInvalidatedNodeSchema,
  AuthorRevisionArtifactKindSchema,
  AuthorRevisionModeSchema,
  AuthorRevisionRecordSchema,
  AuthorRevisionStateSchema,
  ChapterDirectionSelectionSchema
} from '../../src/schemas/index.js';

const validRevision = {
  schemaVersion: '1.0',
  revisionId: 'author_revision_ch001_plan_v1',
  projectId: 'demo-novel',
  chapterNumber: 1,
  artifactKind: 'selected_plan',
  mode: 'direct_edit',
  sourceArtifactPath: 'chapters/chapter_001/selected_plan.md',
  sourceCandidateId: 'plan_001',
  sourceHash: 'a'.repeat(64),
  workingCopyPath: 'chapters/chapter_001/author_revisions/plan_revision_v1.md',
  workingCopyHash: 'b'.repeat(64),
  state: 'ready',
  authorInstruction: null,
  createdAt: '2026-08-04T01:00:00.000Z',
  adoptedAt: null,
  invalidationReportPath: null,
  storyStateMutated: false
};

describe('chapter author revision schemas', () => {
  test('parses the complete author revision record and rejects unknown or unsafe fields', () => {
    expect(AuthorRevisionRecordSchema.parse(validRevision)).toEqual(validRevision);
    expect(() => AuthorRevisionRecordSchema.parse({
      ...validRevision,
      storyStateMutated: true,
      leakedPath: '/home/author/project'
    })).toThrow();
    expect(() => AuthorRevisionRecordSchema.parse({
      ...validRevision,
      sourceArtifactPath: '../state/story_state.json'
    })).toThrow();
  });

  test('accepts every artifact kind, mode, and revision state', () => {
    for (const artifactKind of ['mission', 'selected_plan', 'draft'] as const) {
      expect(AuthorRevisionArtifactKindSchema.parse(artifactKind)).toBe(artifactKind);
    }
    for (const mode of ['direct_edit', 'codex_adjustment'] as const) {
      expect(AuthorRevisionModeSchema.parse(mode)).toBe(mode);
    }
    for (const state of [
      'working',
      'publishing',
      'ready',
      'adopted',
      'rejected',
      'superseded'
    ] as const) {
      expect(AuthorRevisionStateSchema.parse(state)).toBe(state);
    }
  });

  test('defines strict internal publication metadata for publishing adjustments', () => {
    const publishing = AuthorRevisionRecordSchema.parse({
      ...validRevision,
      mode: 'codex_adjustment',
      state: 'publishing',
      publication: {
        revisionToken: `chapter_revision_${'7'.repeat(48)}`,
        projectKey: 'project_radio',
        latestCommittedChapter: 0,
        purpose: 'plan',
        boundAt: '2026-08-04T01:01:00.000Z'
      }
    });

    expect(publishing.publication).toMatchObject({
      projectKey: 'project_radio',
      purpose: 'plan'
    });
    expect(() => AuthorRevisionRecordSchema.parse({
      ...publishing,
      publication: { ...publishing.publication, projectRoot: '/private/project' }
    })).toThrow();
  });

  test('accepts nullable revision fields and enforces lowercase SHA-256 hashes', () => {
    expect(AuthorRevisionRecordSchema.parse({
      ...validRevision,
      artifactKind: 'mission',
      sourceCandidateId: null,
      authorInstruction: 'Preserve the chapter promise.',
      adoptedAt: '2026-08-04T02:00:00.000Z',
      invalidationReportPath: 'chapters/chapter_001/author_revisions/invalidation_v1.json'
    })).toMatchObject({ sourceCandidateId: null });

    for (const sourceHash of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(() => AuthorRevisionRecordSchema.parse({ ...validRevision, sourceHash })).toThrow();
    }
  });

  test('captures selection provenance without allowing Story State mutation', () => {
    const selection = {
      schemaVersion: '1.0',
      selectionId: 'direction_selection_ch001_v1',
      projectId: 'demo-novel',
      chapterNumber: 1,
      previousCandidateId: null,
      selectedCandidateId: 'plan_002',
      modelRecommendedCandidateId: 'plan_001',
      differsFromModelRecommendation: true,
      sourceReviewHash: 'c'.repeat(64),
      selectedPlanHash: 'd'.repeat(64),
      generatedAt: '2026-08-04T01:00:00.000Z',
      invalidationReportPath: null,
      storyStateMutated: false
    };

    expect(ChapterDirectionSelectionSchema.parse(selection)).toEqual(selection);
    expect(() => ChapterDirectionSelectionSchema.parse({ ...selection, extra: 'rejected' })).toThrow();
    expect(() => ChapterDirectionSelectionSchema.parse({ ...selection, storyStateMutated: true })).toThrow();
  });

  test('captures invalidation scope, archived hashes, and bounded queue snapshots', () => {
    for (const node of [
      'plan_candidates',
      'ranking',
      'selected_plan',
      'scene_cards',
      'scene_drafts',
      'draft',
      'future_diagnostics'
    ] as const) {
      expect(AuthorInvalidatedNodeSchema.parse(node)).toBe(node);
    }

    const report = {
      schemaVersion: '1.0',
      reportId: 'author_invalidation_ch001_plan_v1',
      projectId: 'demo-novel',
      chapterNumber: 1,
      revisionId: validRevision.revisionId,
      editedNode: 'selected_plan',
      invalidatedNodes: ['scene_cards', 'scene_drafts', 'draft', 'future_diagnostics'],
      retainedArtifacts: [{
        node: 'selected_plan',
        path: 'chapters/chapter_001/selected_plan.md'
      }],
      archivedArtifacts: [{
        node: 'scene_cards',
        sourcePath: 'chapters/chapter_001/scene_cards.json',
        archivedPath: 'chapters/chapter_001/author_revisions/archive/author_revision_ch001_plan_v1/scene_cards.json',
        hash: 'e'.repeat(64),
        byteSize: 128
      }],
      missingArtifactPaths: ['chapters/chapter_001/draft_v1.md'],
      queueBefore: { status: 'planned_ready', stage: 'ranking' },
      queueAfter: { status: 'planned_ready', stage: 'ranking' },
      reason: 'The author changed the selected plan.',
      nextStep: 'Regenerate scene cards before drafting.',
      generatedAt: '2026-08-04T01:00:00.000Z',
      storyStateMutated: false
    };

    expect(AuthorEditInvalidationReportSchema.parse(report)).toEqual(report);
    expect(() => AuthorEditInvalidationReportSchema.parse({
      ...report,
      archivedArtifacts: [{ ...report.archivedArtifacts[0], hash: 'E'.repeat(64) }]
    })).toThrow();
  });

  test('defines a strict durable adoption journal with complete before and intended records', () => {
    const previous = AuthorRevisionRecordSchema.parse({
      ...validRevision,
      revisionId: 'author_revision_ch001_plan_v1',
      state: 'adopted',
      adoptedAt: '2026-08-04T01:30:00.000Z'
    });
    const target = AuthorRevisionRecordSchema.parse({
      ...validRevision,
      revisionId: 'author_revision_ch001_plan_v2',
      workingCopyPath: 'chapters/chapter_001/author_revisions/plan_revision_v2.md'
    });
    const journal = {
      schemaVersion: '1.0',
      journalId: 'author_adoption_ch001_plan_v1',
      projectId: 'demo-novel',
      chapterNumber: 1,
      artifactKind: 'selected_plan',
      targetRevisionId: target.revisionId,
      invalidationReportPath: 'chapters/chapter_001/author_revisions/edit_invalidation_report_v2.json',
      state: 'prepared',
      mutations: [{
        recordPath: 'chapters/chapter_001/author_revisions/plan_revision_v1.json',
        beforeRecord: previous,
        intendedRecord: { ...previous, state: 'superseded' }
      }, {
        recordPath: 'chapters/chapter_001/author_revisions/plan_revision_v2.json',
        beforeRecord: target,
        intendedRecord: {
          ...target,
          state: 'adopted',
          adoptedAt: '2026-08-04T02:00:00.000Z',
          invalidationReportPath: 'chapters/chapter_001/author_revisions/edit_invalidation_report_v2.json'
        }
      }],
      createdAt: '2026-08-04T02:00:00.000Z',
      updatedAt: '2026-08-04T02:00:00.000Z',
      recoveryReason: null,
      storyStateMutated: false
    };

    expect(AuthorRevisionAdoptionJournalSchema.parse(journal)).toEqual(journal);
    expect(() => AuthorRevisionAdoptionJournalSchema.parse({
      ...journal,
      mutations: journal.mutations.slice(0, 1)
    })).toThrow();
    expect(() => AuthorRevisionAdoptionJournalSchema.parse({
      ...journal,
      state: 'recovered_rolled_back',
      recoveryReason: null
    })).toThrow();
    expect(() => AuthorRevisionAdoptionJournalSchema.parse({
      ...journal,
      storyStateMutated: true
    })).toThrow();
  });
});
