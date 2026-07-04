import { describe, expect, test } from 'vitest';

import { formatCliError } from '../../../src/cli/errors.js';
import { AppError } from '../../../src/utils/AppError.js';

describe('CLI error formatting', () => {
  test('includes stable error code and message for expected application errors', () => {
    expect(formatCliError(new AppError('PROJECT_NOT_FOUND', 'Project not found: /tmp/demo', 2))).toBe(
      'ERROR PROJECT_NOT_FOUND: Project not found: /tmp/demo'
    );
  });

  test('uses a stable unexpected error prefix for unknown failures', () => {
    expect(formatCliError(new Error('boom'))).toBe('ERROR UNEXPECTED: boom');
    expect(formatCliError('raw failure')).toBe('ERROR UNEXPECTED: raw failure');
  });
});
