import path from 'node:path';

import { z } from 'zod';

import { ChapterQueueStageSchema, ChapterQueueStatusSchema } from './planningArtifacts.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 hash.');
const TimestampSchema = z.string().datetime({ offset: true });
const IdentifierSchema = z.string().trim().min(1).max(240);

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
export type ChapterDirectionSelection = z.infer<typeof ChapterDirectionSelectionSchema>;
export type AuthorArtifactReference = z.infer<typeof AuthorArtifactReferenceSchema>;
export type AuthorArchivedArtifactReference = z.infer<typeof AuthorArchivedArtifactReferenceSchema>;
export type AuthorEditInvalidationReport = z.infer<typeof AuthorEditInvalidationReportSchema>;
