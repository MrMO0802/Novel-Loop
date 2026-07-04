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
        issues: []
      },
      { projectId: 'demo-novel', chapterNumber: 1 }
    );

    expect(report.scores.total).toBe(8.5);
    expect(qualityGate(report, 8.2).passed).toBe(true);
  });
});
