import { describe, expect, test } from 'vitest';

import { qualityGate } from '../../src/app/chapterRevisionLoop.js';
import { normalizeDiagnostics } from '../../src/providers/codex/normalizers.js';

describe('Codex slim normalizers', () => {
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
