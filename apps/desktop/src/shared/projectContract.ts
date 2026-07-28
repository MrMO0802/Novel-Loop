import { z } from 'zod';

const ProjectKeySchema = z.string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^project_[A-Za-z0-9_-]+$/);
const IsoTimestampSchema = z.string().max(40).datetime();
const TitleSchema = z.string().trim().min(1).max(160);
const BriefExcerptSchema = z.string().trim().min(1).max(320).nullable();
const LocationLabelSchema = z.string().trim().min(1).max(160);

export const ProjectSummarySchema = z.object({
  projectKey: ProjectKeySchema,
  title: TitleSchema,
  latestCommittedChapter: z.number().int().min(0).max(1_000_000),
  health: z.enum(['ready', 'needs_attention']),
  lastOpenedAt: IsoTimestampSchema,
  briefExcerpt: BriefExcerptSchema,
  locationLabel: LocationLabelSchema,
  storyBibleAvailable: z.boolean(),
  globalPlanAvailable: z.boolean()
}).strict();

const DefaultLocationSchema = z.object({
  configured: z.boolean(),
  locationLabel: LocationLabelSchema.nullable()
}).strict();

export const ProjectLibraryResultSchema = z.object({
  projects: z.array(ProjectSummarySchema).max(5_000),
  defaultLocation: DefaultLocationSchema,
  warning: z.literal('registry_unavailable').nullable()
}).strict().transform((result) => ({
  ...result,
  projects: [...result.projects].sort((left, right) => (
    right.lastOpenedAt.localeCompare(left.lastOpenedAt)
  ))
}));

export const CreateProjectRequestSchema = z.object({
  title: TitleSchema,
  coreIdea: z.string().trim().min(1).max(4_000),
  genre: z.string().trim().min(1).max(160).optional(),
  protagonist: z.string().trim().min(1).max(160).optional(),
  worldPremise: z.string().trim().min(1).max(1_000).optional(),
  useDifferentLocation: z.boolean()
}).strict();

export const ProjectListRequestSchema = z.object({}).strict();
export const ChooseDefaultLibraryRequestSchema = z.object({}).strict();
export const OpenExistingProjectRequestSchema = z.object({}).strict();
export const OpenProjectRequestSchema = z.object({
  projectKey: ProjectKeySchema
}).strict();
export const RemoveProjectRequestSchema = z.object({
  projectKey: ProjectKeySchema
}).strict();

export const LibraryLocationSelectionSchema = z.discriminatedUnion('selection', [
  z.object({
    selection: z.literal('selected'),
    locationLabel: LocationLabelSchema
  }).strict(),
  z.object({ selection: z.literal('cancelled') }).strict(),
  z.object({ selection: z.literal('location_unavailable') }).strict()
]);

export const ProjectOpenResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('created'),
    project: ProjectSummarySchema
  }).strict(),
  z.object({
    outcome: z.literal('opened'),
    project: ProjectSummarySchema
  }).strict(),
  z.object({ outcome: z.literal('cancelled') }).strict(),
  z.object({ outcome: z.literal('invalid_project') }).strict(),
  z.object({ outcome: z.literal('location_required') }).strict(),
  z.object({ outcome: z.literal('location_unavailable') }).strict(),
  z.object({ outcome: z.literal('project_exists') }).strict(),
  z.object({ outcome: z.literal('failed') }).strict()
]);

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectLibraryResult = z.infer<typeof ProjectLibraryResultSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ProjectListRequest = z.infer<typeof ProjectListRequestSchema>;
export type ChooseDefaultLibraryRequest = z.infer<
  typeof ChooseDefaultLibraryRequestSchema
>;
export type OpenExistingProjectRequest = z.infer<
  typeof OpenExistingProjectRequestSchema
>;
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;
export type RemoveProjectRequest = z.infer<typeof RemoveProjectRequestSchema>;
export type LibraryLocationSelection = z.infer<
  typeof LibraryLocationSelectionSchema
>;
export type ProjectOpenResult = z.infer<typeof ProjectOpenResultSchema>;
