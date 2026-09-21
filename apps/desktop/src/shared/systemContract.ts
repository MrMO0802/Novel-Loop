import { z } from 'zod';

export const SupportedDesktopPlatformSchema = z.enum([
  'linux',
  'win32',
  'darwin'
]);

export const SystemReadinessRequestSchema = z.object({}).strict();

const CodexReadinessBaseSchema = z.object({
  summary: z.string().min(1),
  version: z.string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()+-]*$/)
    .nullable()
});

export const CodexReadinessSchema = z.discriminatedUnion('status', [
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(true),
    status: z.literal('ready')
  }).strict(),
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(false),
    status: z.literal('not_installed')
  }).strict(),
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(false),
    status: z.literal('installation_incomplete')
  }).strict(),
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(false),
    status: z.literal('not_logged_in')
  }).strict(),
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(true),
    status: z.literal('warning')
  }).strict(),
  CodexReadinessBaseSchema.extend({
    canRunSmoke: z.literal(false),
    status: z.literal('unavailable')
  }).strict()
]);

export const SystemReadinessSchema = z.object({
  app: z.object({
    name: z.literal('Novel Loop'),
    platform: SupportedDesktopPlatformSchema,
    version: z.string().min(1)
  }).strict(),
  checkedAt: z.string().datetime(),
  codex: CodexReadinessSchema
}).strict();

export type SupportedDesktopPlatform = z.infer<
  typeof SupportedDesktopPlatformSchema
>;
export type SystemReadiness = z.infer<typeof SystemReadinessSchema>;
