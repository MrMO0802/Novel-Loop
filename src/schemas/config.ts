import { z } from 'zod';

export const ProjectIdSchema = z.string().regex(/^[a-z0-9_-]+$/, {
  message: 'projectId must contain only lowercase letters, numbers, underscores, or hyphens'
});

export const ConfigSchema = z.object({
  projectId: ProjectIdSchema,
  language: z.string().min(1).default('zh-CN'),
  defaultProvider: z.enum(['mock', 'real', 'openai', 'custom', 'codex-text']).default('mock'),
  qualityThreshold: z.number().min(0).max(10).default(8.2),
  chapter: z
    .object({
      defaultCandidateCount: z.number().int().positive().default(3),
      maxRevisionAttempts: z.number().int().nonnegative().default(3),
      targetWordCount: z.number().int().positive().default(3500),
      sceneMinCount: z.number().int().positive().default(3),
      sceneMaxCount: z.number().int().positive().default(8)
    })
    .refine((chapter) => chapter.sceneMinCount <= chapter.sceneMaxCount, {
      message: 'sceneMinCount must be less than or equal to sceneMaxCount',
      path: ['sceneMinCount']
    }),
  llm: z
    .object({
      temperature: z.object({
        planning: z.number().min(0).max(2).default(0.6),
        writing: z.number().min(0).max(2).default(0.85),
        diagnostics: z.number().min(0).max(2).default(0.2),
        revision: z.number().min(0).max(2).default(0.45)
      })
    })
    .default({
      temperature: {
        planning: 0.6,
        writing: 0.85,
        diagnostics: 0.2,
        revision: 0.45
      }
    }),
  storage: z
    .object({
      snapshotOnCommit: z.boolean().default(true),
      atomicWrites: z.boolean().default(true)
    })
    .default({
      snapshotOnCommit: true,
      atomicWrites: true
    })
});

export type Config = z.infer<typeof ConfigSchema>;
