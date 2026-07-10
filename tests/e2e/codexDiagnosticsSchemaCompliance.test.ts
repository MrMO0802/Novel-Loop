import { describe, expect, test } from 'vitest';

import { inspectDiagnosticsContractValue } from '../../src/app/codexDiagnosticsSchemaCompliance.js';

describe('M27.12A diagnostics schema compliance evidence', () => {
  test('records precise structured-output violations without collapsing them into schema invalid', () => {
    const result = inspectDiagnosticsContractValue({
      passed: true,
      averageScore: 8.6,
      hardChecks: [
        {
          checkName: 'invented_check',
          result: 'maybe',
          blocking: false,
          evidence: '',
          explanation: 'unknown check',
          extra: true
        }
      ],
      softScores: {},
      diagnostics: [],
      revisionRequired: false,
      inventedTopLevel: true
    });

    expect(result.providerSchemaValid).toBe(false);
    expect(result.missingRequiredFields).toEqual(expect.arrayContaining(['chapterNumber', 'draftVersion']));
    expect(result.unexpectedProperties).toEqual(expect.arrayContaining(['inventedTopLevel', 'hardChecks[0].extra']));
    expect(result.invalidEnumValues).toEqual(expect.arrayContaining(['hardChecks[0].checkName=invented_check', 'hardChecks[0].result=maybe']));
    expect(result.providerSchemaErrors.length).toBeGreaterThan(0);
  });
});
