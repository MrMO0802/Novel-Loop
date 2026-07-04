import { z } from 'zod';

import { CharacterStateSchema } from './characterState.js';
import { ForeshadowingSchema } from './foreshadowing.js';
import { NarrativeDebtSchema } from './narrativeDebt.js';
import { ReaderStateSchema } from './readerState.js';

export const CanonFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceChapter: z.number().int().positive(),
  sourceSceneId: z.string().optional(),
  type: z.enum(['event', 'character', 'world', 'relationship', 'object', 'mystery', 'theme']),
  visibility: z.object({
    reader: z.boolean(),
    author: z.boolean().default(true),
    characters: z.record(z.string(), z.boolean()).default({})
  }),
  confidence: z.enum(['explicit', 'strongly_implied', 'weakly_implied']).default('explicit'),
  createdAt: z.string()
});

export const WorldRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  rule: z.string(),
  exceptions: z.array(z.string()).default([]),
  source: z.enum(['bible', 'chapter', 'editor']),
  sourceChapter: z.number().int().positive().optional(),
  strictness: z.enum(['hard', 'soft']),
  status: z.enum(['active', 'deprecated']).default('active')
});

export const TimelineEventSchema = z.object({
  id: z.string(),
  chapter: z.number().int().positive(),
  sceneId: z.string().optional(),
  order: z.number().int().positive().optional(),
  summary: z.string(),
  participants: z.array(z.string()).default([]),
  location: z.string().optional(),
  timestampLabel: z.string().optional()
});

export const PlotThreadSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'paused', 'resolved', 'abandoned']).default('active'),
  summary: z.string(),
  relatedCharacters: z.array(z.string()).default([]),
  relatedDebts: z.array(z.string()).default([])
});

export const RelationshipNodeSchema = z.object({
  characterId: z.string(),
  label: z.string().optional()
});

export const RelationshipEdgeSchema = z.object({
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  relationship: z.string(),
  status: z.string().optional(),
  evidence: z.string().optional()
});

export const RelationshipGraphSchema = z.object({
  nodes: z.array(RelationshipNodeSchema).default([]),
  edges: z.array(RelationshipEdgeSchema).default([])
});

export const RevealPlanSchema = z.object({
  id: z.string(),
  truth: z.string(),
  currentStage: z.enum(['hidden', 'hinted', 'suspected', 'partially_revealed', 'revealed']),
  plannedRevealWindow: z.object({
    startChapter: z.number().int().positive(),
    endChapter: z.number().int().positive()
  }),
  forbiddenBeforeChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string()).default([]),
  relatedDebts: z.array(z.string()).default([])
});

export const StoryStateSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectId: z.string(),
  language: z.string().default('zh-CN'),
  latestCommittedChapter: z.number().int().nonnegative(),
  canonFacts: z.array(CanonFactSchema),
  characters: z.array(CharacterStateSchema),
  worldRules: z.array(WorldRuleSchema),
  timeline: z.array(TimelineEventSchema),
  plotThreads: z.array(PlotThreadSchema),
  narrativeDebts: z.array(NarrativeDebtSchema),
  foreshadowing: z.array(ForeshadowingSchema),
  readerState: ReaderStateSchema,
  relationshipGraph: RelationshipGraphSchema,
  revealSchedule: z.array(RevealPlanSchema),
  updatedAt: z.string()
});

export type CanonFact = z.infer<typeof CanonFactSchema>;
export type WorldRule = z.infer<typeof WorldRuleSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type PlotThread = z.infer<typeof PlotThreadSchema>;
export type RelationshipNode = z.infer<typeof RelationshipNodeSchema>;
export type RelationshipEdge = z.infer<typeof RelationshipEdgeSchema>;
export type RelationshipGraph = z.infer<typeof RelationshipGraphSchema>;
export type RevealPlan = z.infer<typeof RevealPlanSchema>;
export type StoryState = z.infer<typeof StoryStateSchema>;
