import path from 'node:path';

import { z } from 'zod';

import { ChapterQueueStageSchema, ChapterQueueStatusSchema } from './planningArtifacts.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 hash.');
const TimestampSchema = z.string().datetime({ offset: true });
const IdentifierSchema = z.string().trim().min(1).max(240);
const AuthorRevisionIdentityPattern =
  /^author_revision_ch(\d{3})_(mission|plan|draft)_v([1-9]\d*)$/u;

const ProjectRelativePathSchema = z.string().min(1).max(1024).superRefine((value, context) => {
  const normalized = path.posix.normalize(value);
  if (
    path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || value.includes('\\')
    || normalized === '.'
    || normalized.startsWith('../')
    || normalized !== value
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected a canonical project-relative path.'
    });
  }
});

export const AuthorRevisionArtifactKindSchema = z.enum([
  'mission',
  'selected_plan',
  'draft'
]);

export const AuthorRevisionModeSchema = z.enum([
  'direct_edit',
  'codex_adjustment'
]);

export const AuthorRevisionStateSchema = z.enum([
  'working',
  'publishing',
  'ready',
  'adopted',
  'rejected',
  'superseded'
]);

export const AuthorRevisionPublicationSchema = z.object({
  revisionToken: z.string().regex(/^chapter_revision_[a-f0-9]{48}$/u),
  projectKey: z.string().trim().min(1).max(96).regex(/^project_[A-Za-z0-9_-]+$/u),
  latestCommittedChapter: z.number().int().nonnegative(),
  purpose: z.enum(['mission', 'plan']),
  boundAt: TimestampSchema
}).strict();

export const AuthorInvalidatedNodeSchema = z.enum([
  'mission',
  'plan_candidates',
  'ranking',
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft',
  'future_diagnostics'
]);

export const AuthorRevisionRecordSchema = z.object({
  schemaVersion: z.literal('1.0'),
  revisionId: IdentifierSchema.regex(/^author_revision_ch\d{3}_(?:mission|plan|draft)_v[1-9]\d*$/u),
  projectId: IdentifierSchema,
  chapterNumber: z.number().int().positive(),
  artifactKind: AuthorRevisionArtifactKindSchema,
  mode: AuthorRevisionModeSchema,
  sourceArtifactPath: ProjectRelativePathSchema,
  sourceCandidateId: IdentifierSchema.nullable(),
  sourceHash: Sha256Schema,
  workingCopyPath: ProjectRelativePathSchema,
  workingCopyHash: Sha256Schema,
  state: AuthorRevisionStateSchema,
  publication: AuthorRevisionPublicationSchema.nullable().optional(),
  authorInstruction: z.string().max(4_000).nullable(),
  createdAt: TimestampSchema,
  adoptedAt: TimestampSchema.nullable(),
  invalidationReportPath: ProjectRelativePathSchema.nullable(),
  storyStateMutated: z.literal(false)
}).strict().superRefine((record, context) => {
  const identity = AuthorRevisionIdentityPattern.exec(record.revisionId);
  const expectedLabel = record.artifactKind === 'selected_plan'
    ? 'plan'
    : record.artifactKind;
  const expectedChapter = String(record.chapterNumber).padStart(3, '0');
  const expectedWorkingCopyPath = identity === null
    ? null
    : `chapters/chapter_${identity[1]}/author_revisions/${identity[2]}_revision_v${identity[3]}.md`;
  if (
    identity === null
    || identity[1] !== expectedChapter
    || identity[2] !== expectedLabel
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['revisionId'],
      message: 'Revision identity does not match its chapter and artifact kind.'
    });
  }
  if (expectedWorkingCopyPath === null || record.workingCopyPath !== expectedWorkingCopyPath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workingCopyPath'],
      message: 'Revision working copy must use its canonical chapter revision path.'
    });
  }
  const requiresCandidate = record.artifactKind === 'selected_plan';
  if (requiresCandidate !== (record.sourceCandidateId !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceCandidateId'],
      message: 'Only selected plan revisions bind a source candidate.'
    });
  }
  if (record.state === 'publishing' && record.mode !== 'codex_adjustment') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['state'],
      message: 'Only Codex adjustments may enter publication.'
    });
  }
  if (record.publication !== undefined && record.publication !== null) {
    const expectedPurpose = record.artifactKind === 'mission'
      ? 'mission'
      : record.artifactKind === 'selected_plan'
        ? 'plan'
        : null;
    if (
      record.mode !== 'codex_adjustment'
      || record.publication.purpose !== expectedPurpose
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['publication'],
        message: 'Publication metadata does not match the adjustment artifact.'
      });
    }
  }
});

export const AuthorRevisionAdoptionJournalStateSchema = z.enum([
  'prepared',
  'committed',
  'recovered_rolled_back'
]);

export const AuthorRevisionAdoptionRecoveryReasonSchema = z.enum([
  'in_process_failure',
  'read_time_recovery'
]);

export const AuthorRevisionAdoptionMutationSchema = z.object({
  recordPath: ProjectRelativePathSchema,
  beforeRecord: AuthorRevisionRecordSchema,
  intendedRecord: AuthorRevisionRecordSchema
}).strict().superRefine((mutation, context) => {
  const before = mutation.beforeRecord;
  const intended = mutation.intendedRecord;
  const immutableFields = [
    'schemaVersion',
    'revisionId',
    'projectId',
    'chapterNumber',
    'artifactKind',
    'mode',
    'sourceCandidateId',
    'sourceHash',
    'workingCopyPath',
    'workingCopyHash',
    'authorInstruction',
    'createdAt',
    'storyStateMutated'
  ] as const;
  for (const field of immutableFields) {
    if (before[field] !== intended[field]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intendedRecord', field],
        message: 'An adoption transaction cannot change immutable revision data.'
      });
    }
  }
  const identity = AuthorRevisionIdentityPattern.exec(before.revisionId);
  const expectedRecordPath = identity === null
    ? null
    : `chapters/chapter_${identity[1]}/author_revisions/${identity[2]}_revision_v${identity[3]}.json`;
  if (expectedRecordPath === null || mutation.recordPath !== expectedRecordPath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recordPath'],
      message: 'Adoption mutation must use the canonical revision record path.'
    });
  }
});

export const AuthorRevisionAdoptionJournalSchema = z.object({
  schemaVersion: z.literal('1.0'),
  journalId: IdentifierSchema.regex(
    /^author_adoption_ch\d{3}_(?:mission|plan|draft)_v[1-9]\d*$/u
  ),
  projectId: IdentifierSchema,
  chapterNumber: z.number().int().positive(),
  artifactKind: AuthorRevisionArtifactKindSchema,
  targetRevisionId: IdentifierSchema.regex(
    /^author_revision_ch\d{3}_(?:mission|plan|draft)_v[1-9]\d*$/u
  ),
  invalidationReportPath: ProjectRelativePathSchema.nullable(),
  state: AuthorRevisionAdoptionJournalStateSchema,
  mutations: z.array(AuthorRevisionAdoptionMutationSchema).min(1).max(256),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  recoveryReason: AuthorRevisionAdoptionRecoveryReasonSchema.nullable(),
  storyStateMutated: z.literal(false)
}).strict().superRefine((journal, context) => {
  const recordPaths = new Set<string>();
  let targetMutationCount = 0;
  for (const [index, mutation] of journal.mutations.entries()) {
    if (recordPaths.has(mutation.recordPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mutations', index, 'recordPath'],
        message: 'Adoption transaction record paths must be unique.'
      });
    }
    recordPaths.add(mutation.recordPath);
    for (const record of [mutation.beforeRecord, mutation.intendedRecord]) {
      if (
        record.projectId !== journal.projectId
        || record.chapterNumber !== journal.chapterNumber
        || record.artifactKind !== journal.artifactKind
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mutations', index],
          message: 'Adoption transaction records must match the journal scope.'
        });
      }
    }
    if (mutation.beforeRecord.revisionId === journal.targetRevisionId) {
      targetMutationCount += 1;
      if (mutation.intendedRecord.state !== 'adopted') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mutations', index, 'intendedRecord', 'state'],
          message: 'The target revision must become adopted.'
        });
      }
    }
  }
  if (targetMutationCount !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mutations'],
      message: 'The adoption transaction must include exactly one target revision.'
    });
  }
  const recovered = journal.state === 'recovered_rolled_back';
  if (recovered !== (journal.recoveryReason !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recoveryReason'],
      message: 'Only a recovered transaction records a recovery reason.'
    });
  }
});

export const ChapterDirectionSelectionSchema = z.object({
  schemaVersion: z.literal('1.0'),
  selectionId: IdentifierSchema,
  projectId: IdentifierSchema,
  chapterNumber: z.number().int().positive(),
  previousCandidateId: IdentifierSchema.nullable(),
  selectedCandidateId: IdentifierSchema,
  modelRecommendedCandidateId: IdentifierSchema,
  differsFromModelRecommendation: z.boolean(),
  sourceReviewHash: Sha256Schema,
  selectedPlanHash: Sha256Schema,
  generatedAt: TimestampSchema,
  invalidationReportPath: ProjectRelativePathSchema.nullable(),
  storyStateMutated: z.literal(false)
}).strict();

export const AuthorArtifactReferenceSchema = z.object({
  node: AuthorInvalidatedNodeSchema,
  path: ProjectRelativePathSchema
}).strict();

export const AuthorArchivedArtifactReferenceSchema = z.object({
  node: AuthorInvalidatedNodeSchema,
  sourcePath: ProjectRelativePathSchema,
  archivedPath: ProjectRelativePathSchema,
  hash: Sha256Schema,
  byteSize: z.number().int().nonnegative()
}).strict();

const AuthorQueueSnapshotSchema = z.object({
  status: ChapterQueueStatusSchema,
  stage: ChapterQueueStageSchema
}).strict();

export const AuthorEditInvalidationReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  reportId: IdentifierSchema,
  projectId: IdentifierSchema,
  chapterNumber: z.number().int().positive(),
  revisionId: IdentifierSchema,
  editedNode: AuthorInvalidatedNodeSchema,
  invalidatedNodes: z.array(AuthorInvalidatedNodeSchema),
  retainedArtifacts: z.array(AuthorArtifactReferenceSchema),
  archivedArtifacts: z.array(AuthorArchivedArtifactReferenceSchema),
  missingArtifactPaths: z.array(ProjectRelativePathSchema),
  queueBefore: AuthorQueueSnapshotSchema,
  queueAfter: AuthorQueueSnapshotSchema,
  reason: z.string().trim().min(1).max(4_000),
  nextStep: z.string().trim().min(1).max(4_000),
  generatedAt: TimestampSchema,
  storyStateMutated: z.literal(false)
}).strict();

export type AuthorRevisionArtifactKind = z.infer<typeof AuthorRevisionArtifactKindSchema>;
export type AuthorRevisionMode = z.infer<typeof AuthorRevisionModeSchema>;
export type AuthorRevisionState = z.infer<typeof AuthorRevisionStateSchema>;
export type AuthorRevisionPublication = z.infer<typeof AuthorRevisionPublicationSchema>;
export type AuthorInvalidatedNode = z.infer<typeof AuthorInvalidatedNodeSchema>;
export type AuthorRevisionRecord = z.infer<typeof AuthorRevisionRecordSchema>;
export type AuthorRevisionAdoptionJournalState = z.infer<
  typeof AuthorRevisionAdoptionJournalStateSchema
>;
export type AuthorRevisionAdoptionRecoveryReason = z.infer<
  typeof AuthorRevisionAdoptionRecoveryReasonSchema
>;
export type AuthorRevisionAdoptionMutation = z.infer<
  typeof AuthorRevisionAdoptionMutationSchema
>;
export type AuthorRevisionAdoptionJournal = z.infer<
  typeof AuthorRevisionAdoptionJournalSchema
>;
export type ChapterDirectionSelection = z.infer<typeof ChapterDirectionSelectionSchema>;
export type AuthorArtifactReference = z.infer<typeof AuthorArtifactReferenceSchema>;
export type AuthorArchivedArtifactReference = z.infer<typeof AuthorArchivedArtifactReferenceSchema>;
export type AuthorEditInvalidationReport = z.infer<typeof AuthorEditInvalidationReportSchema>;
