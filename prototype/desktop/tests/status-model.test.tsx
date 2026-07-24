import { cleanup, render, screen, within } from '@testing-library/react';
import { Gear } from '@phosphor-icons/react';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { IconButton } from '../src/components/IconButton';
import { getStatusMessageKey, StatusLabel } from '../src/components/StatusLabel';

afterEach(cleanup);

const baseStyles = readFileSync('src/styles/base.css', 'utf8');

describe('global focus styles', () => {
  test('keeps the semantic shadow and adds a solid accent outline', () => {
    const focusVisibleRule = baseStyles.match(/button:focus-visible,[\s\S]*?\n\}/)?.[0];

    expect(focusVisibleRule).toContain('box-shadow: var(--nl-focus);');
    expect(focusVisibleRule).toContain('outline: 2px solid var(--nl-accent);');
    expect(focusVisibleRule).toContain('outline-offset: 2px;');
  });
});

describe('StatusLabel', () => {
  test.each([
    ['draft', '草稿', 'neutral', 'status.content.draft'],
    ['revision_candidate', '修订候选', 'accent', 'status.content.revision_candidate'],
    ['accepted_draft', '已采纳草稿', 'accent', 'status.content.accepted_draft'],
    ['commit_preview', '待确认', 'accent', 'status.content.commit_preview'],
    ['committed', '已提交', 'success', 'status.committed'],
    ['planned', '已规划', 'neutral', 'status.chapter.planned'],
    ['drafting', '写作中', 'accent', 'status.chapter.drafting'],
    ['reviewing', '检查中', 'accent', 'status.chapter.reviewing'],
    ['needs_review', '待审阅', 'warning', 'status.chapter.needs_review'],
    ['ready_to_confirm', '待确认', 'accent', 'status.chapter.ready_to_confirm'],
    ['needs_recovery', '需要恢复', 'danger', 'status.chapter.needs_recovery'],
    ['needs_refresh', '需要重新生成', 'warning', 'status.chapter.needs_refresh'],
    ['waiting', '等待中', 'neutral', 'status.task.waiting'],
    ['running', '进行中', 'accent', 'status.task.running'],
    ['cancelling', '正在取消', 'warning', 'status.task.cancelling'],
    ['completed', '已完成', 'success', 'status.task.completed'],
    ['failed', '未完成', 'danger', 'status.task.failed'],
    ['cancelled', '已取消', 'neutral', 'status.task.cancelled'],
    ['recoverable', '可恢复', 'warning', 'status.task.recoverable']
  ] as const)('renders %s as author-facing %s', (status, label, tone, messageKey) => {
    const { container } = render(<StatusLabel status={status} />);

    expect(within(container).getByText(label)).toBeVisible();
    expect(container.firstElementChild).toHaveClass(`nl-status-label--${tone}`);
    expect(container.querySelector('svg')).toBeVisible();
    expect(getStatusMessageKey(status)).toBe(messageKey);
    expect(screen.queryByText(/mutation|artifact|queue|runId/i)).toBeNull();
  });
});

describe('IconButton', () => {
  test('keeps its required label as the accessible name and tooltip when overrides are attempted', () => {
    render(
      <IconButton
        {...({
          'aria-label': '错误名称',
          'aria-labelledby': 'external-label',
          icon: Gear,
          label: '打开设置',
          title: '错误提示'
        } as unknown as ComponentProps<typeof IconButton>)}
      />
    );

    const button = screen.getByRole('button', { name: '打开设置' });

    expect(button).toHaveAttribute('aria-label', '打开设置');
    expect(button).not.toHaveAttribute('aria-labelledby');
    expect(button).toHaveAttribute('title', '打开设置');
  });
});
