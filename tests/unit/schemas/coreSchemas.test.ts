import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  CanonPatchSchema,
  ChapterMissionSchema,
  CharacterStateSchema,
  ConfigSchema,
  DiagnosticsReportSchema,
  ForeshadowingSchema,
  NarrativeDebtSchema,
  PlanCandidateSchema,
  ReaderStateSchema,
  RevisionPlanSchema,
  SceneCardSchema,
  StoryStateSchema
} from '../../../src/schemas/index.js';
import type {
  CanonPatch,
  ChapterMission,
  CharacterState,
  Config,
  DiagnosticsReport,
  Foreshadowing,
  NarrativeDebt,
  ReaderState,
  RevisionPlan,
  SceneCard,
  StoryState
} from '../../../src/schemas/index.js';
import {
  invalidCanonPatch,
  invalidChapterMission,
  invalidCharacterState,
  invalidConfig,
  invalidDiagnosticsReport,
  invalidForeshadowing,
  invalidNarrativeDebt,
  invalidReaderState,
  invalidRevisionPlan,
  invalidSceneCard,
  invalidStoryState
} from '../../fixtures/schemas/invalid.js';
import {
  validCanonPatch,
  validChapterMission,
  validCharacterState,
  validConfig,
  validDiagnosticsReport,
  validForeshadowing,
  validNarrativeDebt,
  validReaderState,
  validRevisionPlan,
  validSceneCard,
  validStoryState
} from '../../fixtures/schemas/valid.js';

interface SafeParser {
  safeParse(input: unknown): { success: boolean };
}

const schemaCases: Array<{
  name: string;
  schema: SafeParser;
  valid: unknown;
  invalid: unknown;
}> = [
  { name: 'ConfigSchema', schema: ConfigSchema, valid: validConfig, invalid: invalidConfig },
  { name: 'StoryStateSchema', schema: StoryStateSchema, valid: validStoryState, invalid: invalidStoryState },
  {
    name: 'CharacterStateSchema',
    schema: CharacterStateSchema,
    valid: validCharacterState,
    invalid: invalidCharacterState
  },
  {
    name: 'NarrativeDebtSchema',
    schema: NarrativeDebtSchema,
    valid: validNarrativeDebt,
    invalid: invalidNarrativeDebt
  },
  {
    name: 'ForeshadowingSchema',
    schema: ForeshadowingSchema,
    valid: validForeshadowing,
    invalid: invalidForeshadowing
  },
  { name: 'ReaderStateSchema', schema: ReaderStateSchema, valid: validReaderState, invalid: invalidReaderState },
  {
    name: 'ChapterMissionSchema',
    schema: ChapterMissionSchema,
    valid: validChapterMission,
    invalid: invalidChapterMission
  },
  { name: 'SceneCardSchema', schema: SceneCardSchema, valid: validSceneCard, invalid: invalidSceneCard },
  {
    name: 'DiagnosticsReportSchema',
    schema: DiagnosticsReportSchema,
    valid: validDiagnosticsReport,
    invalid: invalidDiagnosticsReport
  },
  {
    name: 'RevisionPlanSchema',
    schema: RevisionPlanSchema,
    valid: validRevisionPlan,
    invalid: invalidRevisionPlan
  },
  { name: 'CanonPatchSchema', schema: CanonPatchSchema, valid: validCanonPatch, invalid: invalidCanonPatch }
];

describe('core schemas', () => {
  for (const schemaCase of schemaCases) {
    test(`${schemaCase.name} accepts a valid fixture`, () => {
      expect(schemaCase.schema.safeParse(schemaCase.valid).success).toBe(true);
    });

    test(`${schemaCase.name} rejects an invalid fixture`, () => {
      expect(schemaCase.schema.safeParse(schemaCase.invalid).success).toBe(false);
    });
  }

  test('exports TypeScript types inferred from schemas', () => {
    const config: Config = ConfigSchema.parse(validConfig);
    const storyState: StoryState = StoryStateSchema.parse(validStoryState);
    const character: CharacterState = CharacterStateSchema.parse(validCharacterState);
    const debt: NarrativeDebt = NarrativeDebtSchema.parse(validNarrativeDebt);
    const foreshadowing: Foreshadowing = ForeshadowingSchema.parse(validForeshadowing);
    const readerState: ReaderState = ReaderStateSchema.parse(validReaderState);
    const mission: ChapterMission = ChapterMissionSchema.parse(validChapterMission);
    const sceneCard: SceneCard = SceneCardSchema.parse(validSceneCard);
    const diagnostics: DiagnosticsReport = DiagnosticsReportSchema.parse(validDiagnosticsReport);
    const revisionPlan: RevisionPlan = RevisionPlanSchema.parse(validRevisionPlan);
    const canonPatch: CanonPatch = CanonPatchSchema.parse(validCanonPatch);

    expect(config.projectId).toBe('demo-novel');
    expect(storyState.characters[0]?.id).toBe(character.id);
    expect(storyState.narrativeDebts[0]?.id).toBe(debt.id);
    expect(storyState.foreshadowing[0]?.id).toBe(foreshadowing.id);
    expect(readerState.readerQuestions).toContain('17 楼到底发生了什么？');
    expect(mission.chapterNumber).toBe(sceneCard.chapterNumber);
    expect(diagnostics.missionSatisfaction.allRequiredSatisfied).toBe(true);
    expect(revisionPlan.operations).toHaveLength(1);
    expect(canonPatch.chapterNumber).toBe(1);
  });

  test('rejects blank and oversized plan candidate titles in local and slim output validation', async () => {
    const candidate = {
      id: 'plan_001',
      title: '可用标题',
      summary: '候选方向摘要。',
      markdown: '候选方向正文。'
    };
    const slimSchema = JSON.parse(await readFile(
      path.resolve('schemas/codex-output/slim/planning.plan_candidates.slim.schema.json'),
      'utf8'
    )) as SlimPlanCandidatesSchema;
    const titleSchema = slimSchema.properties.candidates.items.properties.title;

    for (const title of ['   ', 'a'.repeat(241)]) {
      expect(PlanCandidateSchema.safeParse({ ...candidate, title }).success).toBe(false);
      expect(slimSchemaAcceptsTitle(titleSchema, title)).toBe(false);
    }
  });
});

interface SlimPlanCandidatesSchema {
  properties: {
    candidates: {
      items: {
        properties: {
          title: SlimPlanCandidateTitleSchema;
        };
      };
    };
  };
}

interface SlimPlanCandidateTitleSchema {
  type?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

function slimSchemaAcceptsTitle(schema: SlimPlanCandidateTitleSchema, title: string): boolean {
  const minLength = schema.minLength ?? 0;
  const maxLength = schema.maxLength ?? Number.POSITIVE_INFINITY;
  const pattern = schema.pattern === undefined ? undefined : new RegExp(schema.pattern, 'u');
  return schema.type === 'string'
    && title.length >= minLength
    && title.length <= maxLength
    && (pattern === undefined || pattern.test(title));
}
