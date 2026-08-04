import { describe, expect, test } from 'vitest';

import { qualityGate } from '../../src/app/chapterRevisionLoop.js';
import {
  normalizeDiagnostics,
  normalizePlanCandidates
} from '../../src/providers/codex/normalizers.js';

describe('Codex slim normalizers', () => {
  test('assigns canonical ids to plan candidates returned with provider-defined ids', () => {
    const result = normalizePlanCandidates(
      {
        chapterNumber: 1,
        candidates: [
          {
            id: 'ch001_candidate_a',
            title: '车祸先行',
            summary: '从重复车祸建立循环悬念。',
            markdown: '# 车祸先行\n\n林默目睹同一场车祸再次发生。'
          },
          {
            id: 'ch001_candidate_b',
            title: '记录先行',
            summary: '从被删除的记录展开调查。',
            markdown: '# 记录先行\n\n电子记录在凌晨被同步清空。'
          },
          {
            id: 'ch001_candidate_c',
            title: '电话先行',
            summary: '从失踪者的来电引出事故。',
            markdown: '# 电话先行\n\n林夕的旧号码在事故前亮起。'
          }
        ]
      },
      { projectId: 'demo-novel', chapterNumber: 1, candidateCount: 3 }
    );

    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'plan_001',
      'plan_002',
      'plan_003'
    ]);
  });

  test('maps passed slim diagnostics to a score that satisfies the local quality threshold', () => {
    const report = normalizeDiagnostics(
      {
        chapterNumber: 1,
        draftVersion: 1,
        passed: true,
        averageScore: 8,
        hardChecks: [
          { checkName: 'timeline_consistency', result: 'pass', blocking: false, evidence: '', explanation: 'ok' },
          { checkName: 'character_knowledge_consistency', result: 'pass', blocking: false, evidence: '', explanation: 'ok' },
          { checkName: 'world_rule_consistency', result: 'pass', blocking: false, evidence: '', explanation: 'ok' },
          { checkName: 'no_unplanned_reveal', result: 'pass', blocking: false, evidence: '', explanation: 'ok' }
        ],
        softScores: {
          plot_progression: 8,
          character_consistency: 8,
          tension_curve: 8,
          emotional_impact: 8,
          chapter_hook: 8,
          style_match: 8,
          genre_satisfaction: 8,
          reader_curiosity: 8
        },
        diagnostics: [],
        revisionRequired: false
      },
      { projectId: 'demo-novel', chapterNumber: 1 }
    );

    expect(report.scores.total).toBe(8.5);
    expect(qualityGate(report, 8.2).passed).toBe(true);
  });
});
