import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { StatusLabel } from '../src/components/StatusLabel';

describe('StatusLabel', () => {
  test.each([
    ['draft', '草稿'],
    ['revision_candidate', '修订候选'],
    ['commit_preview', '待确认'],
    ['committed', '已提交']
  ] as const)('renders %s as author-facing %s', (status, label) => {
    render(<StatusLabel status={status} />);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText(/mutation|artifact|queue|runId/i)).toBeNull();
  });
});
