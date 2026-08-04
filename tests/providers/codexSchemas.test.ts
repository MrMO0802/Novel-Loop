import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  normalizeMissionAdjustment,
  normalizePlanAdjustment
} from '../../src/providers/codex/normalizers.js';
import { resolveCodexOutputSchema } from '../../src/providers/codex/schemas.js';

describe('Codex chapter adjustment schemas', () => {
  test.each([
    [
      'planning.adjust_chapter_mission_slim',
      'CodexSlimChapterMissionAdjustmentOutputSchema',
      'planning.chapter_mission_adjustment.slim.schema.json'
    ],
    [
      'planning.adjust_plan_candidate_slim',
      'CodexSlimPlanAdjustmentOutputSchema',
      'planning.plan_adjustment.slim.schema.json'
    ]
  ])('registers %s as a bundled strict schema', async (
    promptId,
    schemaName,
    fileName
  ) => {
    const descriptor = resolveCodexOutputSchema(promptId);
    expect(descriptor).toMatchObject({ schemaName });
    expect(path.basename(descriptor!.schemaPath)).toBe(fileName);
    const schema = JSON.parse(await readFile(descriptor!.schemaPath, 'utf8')) as {
      additionalProperties?: unknown;
      required?: unknown;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toBeDefined();
  });

  test('normalizes a complete strict mission adjustment into ChapterMission', () => {
    const result = normalizeMissionAdjustment(missionOutput(), {
      projectId: 'adjustment',
      chapterNumber: 1
    });

    expect(result).toMatchObject({
      chapterNumber: 1,
      chapterFunction: '把开场提前到事故现场。',
      participatingCharacterIds: ['char_lincheng']
    });
    expect(() => normalizeMissionAdjustment({
      ...missionOutput(),
      extra: true
    }, {
      projectId: 'adjustment',
      chapterNumber: 1
    })).toThrow();
  });

  test('accepts only bounded strict plan adjustment fields', () => {
    const output = {
      title: '事故现场先行',
      markdown: '# 事故现场先行\n\n先展示重复事故。\n',
      changeSummary: ['把开场提前到事故现场。'],
      preservedConstraints: ['不新增人物。']
    };
    expect(normalizePlanAdjustment(output)).toEqual(output);
    expect(() => normalizePlanAdjustment({ ...output, sourceHash: 'secret' }))
      .toThrow();
    expect(() => normalizePlanAdjustment({
      ...output,
      markdown: 'x'.repeat(2 * 1024 * 1024 + 1)
    })).toThrow();
    expect(() => normalizePlanAdjustment({
      ...output,
      markdown: '调'.repeat(Math.floor(2 * 1024 * 1024 / 3) + 1)
    })).toThrow();
    expect(() => normalizePlanAdjustment({
      ...output,
      changeSummary: Array.from({ length: 21 }, () => 'change')
    })).toThrow();
  });
});

function missionOutput() {
  return {
    chapterNumber: 1,
    chapterFunction: '把开场提前到事故现场。',
    objectives: ['让林澈核对重复事故。'],
    debtsToPayOrAdvance: ['debt_0001'],
    debtsToIntroduce: [],
    participatingCharacterIds: ['char_lincheng'],
    charactersToIntroduce: [],
    characterDeltas: [{
      characterId: 'char_lincheng',
      from: '逃避麻烦',
      to: '主动核对事故',
      evidenceRequired: '他保存两份互相冲突的记录。'
    }],
    readerKnowledge: ['事故在同一时间重复。'],
    readerQuestions: ['是谁改写事故记录？'],
    forbiddenMoves: ['不要新增人物。']
  };
}
