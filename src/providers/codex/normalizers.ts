import { z } from 'zod';

import {
  ArcMapSchema,
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterPlanRankingSchema,
  ChapterQueueSchema,
  DiagnosticsReportSchema,
  PlanCandidatesSchema,
  RevisionPlanSchema,
  SceneCardsSchema
} from '../../schemas/index.js';
import type { ArcMap, CanonPatch, ChapterMission, ChapterPlanRanking, ChapterQueue, DiagnosticsReport, PlanCandidates, RevisionPlan, SceneCards } from '../../schemas/index.js';
import {
  DESKTOP_SLIM_SCENE_COUNT,
  MAX_SCENE_CARD_CHARACTERS,
  MAX_SCENE_CARD_FIELD_CHARS,
  MAX_SCENE_CARDS_BYTES,
  utf8Bytes
} from '../../utils/chapterWorkloadLimits.js';
import { normalizeDiagnosticsWithReport } from './diagnosticsNormalizer.js';

export {
  CodexDiagnosticsProviderOutputSchema,
  DiagnosticsSemanticContradictionError,
  normalizeDiagnosticsWithReport,
  validateDiagnosticsProviderOutput
} from './diagnosticsNormalizer.js';

export interface CodexNormalizationContext {
  projectId: string;
  chapterNumber?: number;
  candidateCount?: number;
  candidateIds?: string[];
}

const SlimArcMapSchema = z.object({
  arcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string().optional(),
      summary: z.string()
    })
  )
});

const SlimChapterQueueSchema = z.object({
  chapters: z.array(
    z.object({
      chapterNumber: z.number().int().positive(),
      title: z.string(),
      summary: z.string(),
      primaryFunction: z.string(),
      targetDebts: z.array(z.string()).default([])
    })
  )
});

const SlimMissionSchema = z.object({
  chapterNumber: z.number().int().positive(),
  chapterFunction: z.string().trim().min(1).max(2_000),
  objectives: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  debtsToPayOrAdvance: z.array(
    z.string().trim().min(1).max(200)
  ).max(100).default([]),
  debtsToIntroduce: z.array(z.object({
    type: z.string().trim().min(1).max(100),
    promise: z.string().trim().min(1).max(2_000),
    importance: z.number().min(1).max(10)
  }).strict()).max(100).default([]),
  charactersToIntroduce: z.array(z.object({
    characterId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120)
  }).strict()).max(8).default([]),
  characterDeltas: z.array(z.object({
    characterId: z.string().trim().min(1).max(200),
    from: z.string().trim().min(1).max(1_000),
    to: z.string().trim().min(1).max(1_000),
    evidenceRequired: z.string().trim().min(1).max(2_000)
  }).strict()).max(100).default([]),
  readerKnowledge: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  readerQuestions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  forbiddenMoves: z.array(z.string().trim().min(1).max(2_000)).max(100).default([])
});

const SlimPlanCandidatesSchema = z.object({
  chapterNumber: z.number().int().positive(),
  candidates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      markdown: z.string()
    })
  )
});

const SlimRankingSchema = z.object({
  chapterNumber: z.number().int().positive(),
  selectedCandidateId: z.string(),
  rationale: z.string()
});

const SlimSceneTextSchema = z.string().trim().min(1).max(MAX_SCENE_CARD_FIELD_CHARS);

const SlimSceneCardsSchema = z.object({
  scenes: z.array(
    z.object({
      purpose: SlimSceneTextSchema,
      conflict: SlimSceneTextSchema,
      entryPoint: SlimSceneTextSchema,
      exitPoint: SlimSceneTextSchema,
      location: SlimSceneTextSchema,
      characters: z.array(z.string().min(1).max(200))
        .min(1)
        .max(MAX_SCENE_CARD_CHARACTERS)
    })
  ).length(DESKTOP_SLIM_SCENE_COUNT)
}).superRefine((value, context) => {
  if (utf8Bytes(JSON.stringify(value)) > MAX_SCENE_CARDS_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['scenes'],
      message: 'scene-card output exceeds the desktop workload budget'
    });
  }
});

const SlimRevisionPlanSchema = z.object({
  chapterNumber: z.number().int().positive(),
  fromDraftVersion: z.number().int().positive(),
  strategy: z.string(),
  operations: z.array(
    z.object({
      targetType: z.string(),
      sceneId: z.string(),
      operation: z.string(),
      reason: z.string(),
      instruction: z.string()
    })
  ),
  riskNotes: z.array(z.string()).default([])
});

const SlimCanonPatchProposalSchema = z.object({
  chapterNumber: z.number().int().positive(),
  sourceFinalPath: z.string(),
  latestCommittedChapter: z.number().int().nonnegative(),
  newFacts: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      sourceChapter: z.number().int().positive(),
      type: z.string(),
      readerVisible: z.boolean(),
      authorVisible: z.boolean(),
      visibleCharacterIds: z.array(z.string()).default([]),
      confidence: z.string(),
      createdAt: z.string()
    })
  ),
  characterStates: z.array(
    z.object({
      characterId: z.string(),
      summary: z.string()
    })
  ),
  characterUpdates: z.array(
    z.object({
      characterId: z.string(),
      field: z.string(),
      oldValueSummary: z.string(),
      newValue: z.string(),
      reason: z.string()
    })
  ),
  timelineEvents: z.array(
    z.object({
      id: z.string(),
      chapter: z.number().int().positive(),
      sceneId: z.string(),
      order: z.number().int().positive(),
      summary: z.string(),
      participants: z.array(z.string()).default([]),
      location: z.string(),
      timestampLabel: z.string()
    })
  ),
  narrativeDebtUpdates: z.array(
    z.object({
      debtId: z.string(),
      action: z.enum(['create', 'maintain', 'escalate', 'partially_pay', 'pay', 'cancel']),
      text: z.string()
    })
  ),
  foreshadowingUpdates: z.array(
    z.object({
      foreshadowingId: z.string(),
      action: z.enum(['create', 'reinforce', 'partially_pay', 'pay', 'abandon']),
      text: z.string()
    })
  ),
  readerStatePatch: z.object({
    addKnows: z.array(z.string()).default([]),
    addSuspects: z.array(z.string()).default([]),
    addQuestions: z.array(z.string()).default([]),
    removeQuestions: z.array(z.string()).default([]),
    addExpectations: z.array(z.string()).default([]),
    addDoesNotKnow: z.array(z.string()).default([])
  }),
  relationshipUpdates: z.array(
    z.object({
      fromCharacterId: z.string(),
      toCharacterId: z.string(),
      change: z.string(),
      evidence: z.string()
    })
  ),
  revealScheduleUpdates: z.array(
    z.object({
      revealId: z.string(),
      action: z.enum(['create', 'advance_stage', 'mark_revealed', 'delay']),
      text: z.string()
    })
  )
});

export function isCodexSlimPrompt(promptId: string): boolean {
  return promptId.endsWith('_minimal_json') || promptId.endsWith('_slim');
}

export function normalizeCodexSlimOutput(promptId: string, value: unknown, context: CodexNormalizationContext): unknown {
  if (promptId === 'planning.generate_arc_map_minimal_json') {
    return normalizeArcMap(value, context);
  }
  if (promptId === 'planning.generate_chapter_queue_minimal_json') {
    return normalizeChapterQueue(value, context);
  }
  if (promptId === 'planning.plan_chapter_mission_slim') {
    return normalizeMission(value, context);
  }
  if (promptId === 'planning.generate_plan_candidates_slim') {
    return normalizePlanCandidates(value, context);
  }
  if (promptId === 'planning.rank_plan_candidates_slim') {
    return normalizeRanking(value, context);
  }
  if (promptId === 'planning.generate_scene_cards_slim') {
    return normalizeSceneCards(value, context);
  }
  if (promptId === 'diagnostics.diagnose_chapter_slim') {
    return normalizeDiagnostics(value, context);
  }
  if (promptId === 'revision.create_revision_plan_slim') {
    return normalizeRevisionPlan(value, context);
  }
  if (promptId === 'memory.extract_canon_patch_proposal_slim') {
    return normalizeCanonPatchProposal(value, context);
  }
  return value;
}

export function normalizeArcMap(value: unknown, context: CodexNormalizationContext): ArcMap {
  const slim = SlimArcMapSchema.parse(value);
  return ArcMapSchema.parse({
    schemaVersion: '1.0',
    projectId: context.projectId,
    arcs: slim.arcs.map((arc) => ({
      id: arc.id,
      name: arc.name,
      type: coerceArcType(arc.type),
      summary: arc.summary,
      relatedCharacters: [],
      relatedThreads: []
    }))
  });
}

export function normalizeChapterQueue(value: unknown, context: CodexNormalizationContext): ChapterQueue {
  const slim = SlimChapterQueueSchema.parse(value);
  return ChapterQueueSchema.parse({
    schemaVersion: '1.0',
    projectId: context.projectId,
    chapters: slim.chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      status: 'planned',
      currentStage: 'none',
      completedStages: [],
      summary: chapter.summary,
      primaryFunction: chapter.primaryFunction,
      targetDebts: chapter.targetDebts
    }))
  });
}

export function normalizeMission(value: unknown, context: CodexNormalizationContext): ChapterMission {
  const slim = SlimMissionSchema.parse(value);
  const chapterNumber = context.chapterNumber ?? slim.chapterNumber;
  return ChapterMissionSchema.parse({
    id: `mission_ch${String(chapterNumber).padStart(3, '0')}_codex`,
    chapterNumber,
    chapterFunction: slim.chapterFunction,
    requiredObjectives: slim.objectives.map((objective, index) => ({
      id: `obj_${String(index + 1).padStart(3, '0')}`,
      text: objective,
      type: index === 0 ? 'plot' : 'reader',
      priority: index === 0 ? 'must' : 'should'
    })),
    debtsToPayOrAdvance: slim.debtsToPayOrAdvance,
    debtsToIntroduce: slim.debtsToIntroduce,
    charactersToIntroduce: slim.charactersToIntroduce,
    characterDeltas: slim.characterDeltas,
    readerInformationDelta: {
      newKnowledge: slim.readerKnowledge,
      newSuspicions: [],
      questionsToMaintain: slim.readerQuestions,
      questionsToAnswer: []
    },
    forbiddenMoves: slim.forbiddenMoves,
    targetEmotionalCurve: ['curiosity', 'tension']
  });
}

export function normalizePlanCandidates(value: unknown, context: CodexNormalizationContext): PlanCandidates {
  const slim = SlimPlanCandidatesSchema.parse(value);
  return PlanCandidatesSchema.parse({
    chapterNumber: context.chapterNumber ?? slim.chapterNumber,
    candidates: slim.candidates.map((candidate) => ({
      ...candidate,
      strengths: [],
      risks: []
    }))
  });
}

export function normalizeRanking(value: unknown, context: CodexNormalizationContext): ChapterPlanRanking {
  const slim = SlimRankingSchema.parse(value);
  const candidateIds = context.candidateIds ?? [slim.selectedCandidateId];
  return ChapterPlanRankingSchema.parse({
    chapterNumber: context.chapterNumber ?? slim.chapterNumber,
    selectedCandidateId: slim.selectedCandidateId,
    selectedPlanPath: `chapters/chapter_${String(context.chapterNumber ?? slim.chapterNumber).padStart(3, '0')}/plan_candidates/${slim.selectedCandidateId}.md`,
    rationale: slim.rationale,
    candidates: candidateIds.map((candidateId, index) => ({
      candidateId,
      planPath: `chapters/chapter_${String(context.chapterNumber ?? slim.chapterNumber).padStart(3, '0')}/plan_candidates/${candidateId}.md`,
      scores: {
        plot_progression: candidateId === slim.selectedCandidateId ? 8 : 6,
        character_arc_value: candidateId === slim.selectedCandidateId ? 7 : 6,
        tension_potential: candidateId === slim.selectedCandidateId ? 8 : 6,
        continuity_risk: candidateId === slim.selectedCandidateId ? 2 : 4,
        reader_hook_strength: candidateId === slim.selectedCandidateId ? 8 : 6,
        genre_satisfaction: candidateId === slim.selectedCandidateId ? 8 : 6
      },
      totalScore: candidateId === slim.selectedCandidateId ? 8 : Math.max(1, 6 - index * 0.2),
      strengths: [],
      risks: []
    }))
  });
}

export function normalizeSceneCards(value: unknown, context: CodexNormalizationContext): SceneCards {
  const slim = SlimSceneCardsSchema.parse(value);
  const chapterNumber = context.chapterNumber ?? 1;
  return SceneCardsSchema.parse(
    slim.scenes.map((scene, index) => ({
      sceneId: `scene_${String(index + 1).padStart(3, '0')}`,
      chapterNumber,
      order: index + 1,
      purpose: scene.purpose,
      conflict: scene.conflict,
      entryPoint: scene.entryPoint,
      exitPoint: scene.exitPoint,
      characters: scene.characters,
      location: scene.location,
      time: index === 0 ? 'night' : 'later that night',
      informationDelta: [`Scene ${index + 1} advances the selected plan.`],
      emotionalShift: index === 0 ? 'curiosity to unease' : 'unease to resolve',
      readerEffect: index === slim.scenes.length - 1 ? 'hook' : 'curiosity',
      constraints: ['Do not reveal final answers.'],
      beats: [scene.entryPoint, scene.conflict, scene.exitPoint]
    }))
  );
}

export function normalizeDiagnostics(value: unknown, context: CodexNormalizationContext): DiagnosticsReport {
  return normalizeDiagnosticsWithReport(value, context).report;
}

export function normalizeRevisionPlan(value: unknown, context: CodexNormalizationContext): RevisionPlan {
  const slim = SlimRevisionPlanSchema.parse(value);
  const strategy = coerceRevisionStrategy(slim.strategy);
  return RevisionPlanSchema.parse({
    chapterNumber: context.chapterNumber ?? slim.chapterNumber,
    fromDraftVersion: slim.fromDraftVersion,
    revision_strategy: strategy,
    strategy,
    operations: slim.operations.map((operation) => ({
      target:
        operation.targetType === 'scene' && operation.sceneId.length > 0
          ? { type: 'scene', sceneId: operation.sceneId }
          : { type: 'whole_chapter' },
      operation: operation.operation,
      reason: operation.reason,
      concrete_instruction: operation.instruction,
      instruction: operation.instruction
    })),
    riskNotes: slim.riskNotes
  });
}

export function normalizeCanonPatchProposal(value: unknown, context: CodexNormalizationContext): CanonPatch {
  const existingPatch = CanonPatchSchema.safeParse(value);
  const patch = existingPatch.success ? existingPatch.data : normalizeSlimCanonPatchProposal(value);
  return CanonPatchSchema.parse({
    ...patch,
    chapterNumber: context.chapterNumber ?? patch.chapterNumber,
    latestCommittedChapter: context.chapterNumber ?? patch.latestCommittedChapter ?? patch.chapterNumber
  });
}

function normalizeSlimCanonPatchProposal(value: unknown): CanonPatch {
  const slim = SlimCanonPatchProposalSchema.parse(value);
  return CanonPatchSchema.parse({
    chapterNumber: slim.chapterNumber,
    sourceFinalPath: slim.sourceFinalPath,
    latestCommittedChapter: slim.chapterNumber,
    newFacts: slim.newFacts.map((fact) => ({
      id: fact.id,
      text: fact.text,
      sourceChapter: fact.sourceChapter,
      type: coerceCanonFactType(fact.type),
      visibility: {
        reader: fact.readerVisible,
        author: fact.authorVisible,
        characters: Object.fromEntries(fact.visibleCharacterIds.map((characterId) => [characterId, true]))
      },
      confidence: coerceCanonFactConfidence(fact.confidence),
      createdAt: fact.createdAt
    })),
    characterStates:
      slim.chapterNumber === 1
        ? slim.characterStates.map((character) => ({
            id: character.characterId,
            name: character.characterId === 'char_lincheng' ? 'Lin Cheng' : character.characterId,
            role: character.characterId === 'char_lincheng' ? 'protagonist' : 'supporting',
            publicDescription: character.summary,
            privateTruths: [],
            personality: [],
            currentGoal: character.summary,
            emotionalState: 'alert',
            knowledge: [],
            arc: {},
            constraints: [],
            lastUpdatedChapter: slim.chapterNumber
          }))
        : [],
    characterUpdates: slim.characterUpdates,
    timelineEvents: slim.timelineEvents,
    narrativeDebtUpdates: slim.narrativeDebtUpdates.map((update, index) => ({
      debtId: update.debtId.length === 0 ? undefined : update.debtId,
      action: update.action,
      payload: normalizeSlimNarrativeDebtPayload(update, slim.chapterNumber, index)
    })),
    foreshadowingUpdates: slim.foreshadowingUpdates.map((update, index) => ({
      foreshadowingId: update.foreshadowingId.length === 0 ? undefined : update.foreshadowingId,
      action: update.action,
      payload: normalizeSlimForeshadowingPayload(update, slim.chapterNumber, index)
    })),
    readerStatePatch: slim.readerStatePatch,
    relationshipUpdates: slim.relationshipUpdates,
    revealScheduleUpdates: slim.revealScheduleUpdates.map((update) => ({
      revealId: update.revealId.length === 0 ? undefined : update.revealId,
      action: update.action,
      payload: { text: update.text }
    }))
  });
}

function normalizeSlimNarrativeDebtPayload(
  update: { debtId: string; action: 'create' | 'maintain' | 'escalate' | 'partially_pay' | 'pay' | 'cancel'; text: string },
  chapterNumber: number,
  index: number
): unknown {
  if (update.action !== 'create') {
    return { text: update.text };
  }
  const id = update.debtId.length > 0 ? update.debtId : `ch${String(chapterNumber).padStart(3, '0')}_debt_${String(index + 1).padStart(3, '0')}`;
  return {
    id,
    type: 'mystery',
    promise: update.text,
    readerQuestion: update.text.endsWith('?') || update.text.endsWith('？') ? update.text : `${update.text}？`,
    introducedInChapter: chapterNumber,
    status: 'open',
    importance: 7,
    urgency: 6,
    relatedCharacters: [],
    relatedThreads: [],
    payoffHistory: []
  };
}

function normalizeSlimForeshadowingPayload(
  update: { foreshadowingId: string; action: 'create' | 'reinforce' | 'partially_pay' | 'pay' | 'abandon'; text: string },
  chapterNumber: number,
  index: number
): unknown {
  if (update.action !== 'create') {
    return { text: update.text };
  }
  const id =
    update.foreshadowingId.length > 0 ? update.foreshadowingId : `ch${String(chapterNumber).padStart(3, '0')}_foreshadow_${String(index + 1).padStart(3, '0')}`;
  return {
    id,
    surfaceDetail: update.text,
    hiddenMeaning: update.text,
    introducedInChapter: chapterNumber,
    status: 'unresolved',
    subtlety: 'medium'
  };
}

function coerceCanonFactType(type: string): 'event' | 'character' | 'world' | 'relationship' | 'object' | 'mystery' | 'theme' {
  if (type === 'event' || type === 'character' || type === 'world' || type === 'relationship' || type === 'object' || type === 'mystery' || type === 'theme') {
    return type;
  }
  if (type === 'setting' || type === 'location' || type === 'rule') {
    return 'world';
  }
  if (type === 'supernatural' || type === 'clue' || type === 'unknown') {
    return 'mystery';
  }
  return 'world';
}

function coerceCanonFactConfidence(confidence: string): 'explicit' | 'strongly_implied' | 'weakly_implied' {
  if (confidence === 'explicit' || confidence === 'strongly_implied' || confidence === 'weakly_implied') {
    return confidence;
  }
  if (confidence === 'high' || confidence === 'confirmed' || confidence === 'certain') {
    return 'explicit';
  }
  if (confidence === 'medium' || confidence === 'likely' || confidence === 'implied') {
    return 'strongly_implied';
  }
  return 'weakly_implied';
}

function coerceArcType(type: string | undefined): 'plot' | 'character' | 'relationship' | 'world' | 'theme' {
  if (type === 'character' || type === 'relationship' || type === 'world' || type === 'theme') return type;
  return 'plot';
}

function coerceRevisionStrategy(strategy: string): RevisionPlan['strategy'] {
  if (
    strategy === 'local_patch' ||
    strategy === 'rewrite_scene' ||
    strategy === 'reorder_scenes' ||
    strategy === 'strengthen_hook' ||
    strategy === 'reduce_exposition' ||
    strategy === 'fix_character_motivation' ||
    strategy === 'delay_reveal' ||
    strategy === 'payoff_debt' ||
    strategy === 'full_chapter_rewrite' ||
    strategy === 'human_review'
  ) {
    return strategy;
  }
  return 'local_patch';
}
