import { z } from 'zod';

export const SupportedDesktopPlatformSchema = z.enum([
  'linux',
  'win32',
  'darwin'
]);

export const SystemReadinessRequestSchema = z.object({}).strict();

export const SystemReadinessSchema = z.object({
  app: z.object({
    name: z.literal('Novel Loop'),
    platform: SupportedDesktopPlatformSchema,
    version: z.string().min(1)
  }).strict(),
  checkedAt: z.string().datetime(),
  codex: z.object({
    canRunSmoke: z.boolean(),
    status: z.enum([
      'ready',
      'not_installed',
      'not_logged_in',
      'warning',
      'unavailable'
    ]),
    summary: z.string().min(1),
    version: z.string().min(1).nullable()
  }).strict()
}).strict();

export type SupportedDesktopPlatform = z.infer<
  typeof SupportedDesktopPlatformSchema
>;
export type SystemReadiness = z.infer<typeof SystemReadinessSchema>;
