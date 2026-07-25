import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../src/app/App';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const onboardingStyles = readFileSync('src/styles/onboarding.css', 'utf8');

function renderRoute(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('first launch readiness', () => {
  test('ready state enables Continue and opens the library', async () => {
    const user = userEvent.setup();
    renderRoute('/setup?state=ready');

    expect(screen.getByText('Codex 已准备好')).toBeVisible();
    const continueButton = screen.getByRole('button', { name: '继续' });
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);

    expect(screen.getByRole('heading', { name: '作品库' })).toBeVisible();
  }, 15_000);

  test('missing state offers the guide and another check', () => {
    renderRoute('/setup?state=missing');

    expect(screen.getByText('未找到 Codex')).toBeVisible();
    expect(screen.getByRole('button', { name: '打开指南' })).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible();
  });

  test('login state never exposes credentials, paths, or terminal arguments', () => {
    renderRoute('/setup?state=login');

    expect(screen.getByText('Codex 需要登录')).toBeVisible();
    expect(screen.getByRole('button', { name: '查看登录说明' })).toBeVisible();
    expect(document.body).not.toHaveTextContent(/token|auth\.json|\.codex|--json|--full-auto/i);
  });

  test('doctor warning remains non-blocking', () => {
    renderRoute('/setup?state=warning');

    expect(screen.getByText('写作功能可以使用')).toBeVisible();
    expect(screen.getByText('这项提醒不会阻止你继续。')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible();
  });

  test.each([
    ['/setup?state=missing', '打开指南', '安装指南', '完成安装后回到这里重新检查。'],
    ['/setup?state=login', '查看登录说明', '登录说明', '按页面提示完成登录。'],
    ['/setup?state=warning', '查看处理建议', '处理建议', '你可以继续写作。']
  ])('shows controlled guidance for %s', async (route, action, title, copy) => {
    const user = userEvent.setup();
    renderRoute(route);

    await user.click(screen.getByRole('button', { name: action }));

    const guidance = screen.getByRole('region', { name: title });
    expect(guidance).toHaveTextContent(copy);
    expect(guidance).not.toHaveTextContent(/token|auth\.json|\.codex|--json|--full-auto|终端|命令行/i);
  });

  test.each([
    ['/setup?state=missing', '检查完成，仍未找到 Codex。'],
    ['/setup?state=login', '检查完成，仍需要登录。'],
    ['/setup?state=warning', '检查完成，写作功能仍可使用。']
  ])('announces fixture recheck progress and result for %s', async (route, result) => {
    vi.useFakeTimers();
    renderRoute(route);

    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));

    expect(screen.getByRole('status')).toHaveTextContent('正在重新检查');
    act(() => vi.advanceTimersByTime(120));

    expect(screen.getByText(result)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(result);
  });
});

describe('project library', () => {
  test('project-free pages span the full shell workspace', () => {
    expect(onboardingStyles).toMatch(
      /\.nl-application-shell__workspace > \.nl-application-shell__main:only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/
    );
  });

  test('keeps non-linked project titles out of secondary subtitle styling', () => {
    expect(onboardingStyles).toMatch(
      /\.nl-project-row__identity span:not\(\.nl-project-row__title\),\s*\.nl-project-row__metric/
    );
    expect(onboardingStyles).toMatch(
      /\.nl-project-row__identity span:not\(\.nl-project-row__title\)\s*\{/
    );
  });

  test('presents the current work and projects as a readable list', () => {
    renderRoute('/library');

    const continuePanel = screen.getByLabelText('继续创作');
    expect(within(continuePanel).getByRole('heading', { name: '雨夜电台' })).toBeVisible();
    expect(within(continuePanel).getByRole('button', { name: '审阅第二章' })).toBeVisible();

    const projectList = screen.getByRole('list', { name: '我的作品' });
    expect(within(projectList).getByText('42,680 字')).toBeVisible();
    expect(within(projectList).getByText('1 项待审阅')).toBeVisible();
    expect(screen.getByText('已归档作品（1）')).toBeVisible();
  });

  test('links only projects with implemented prototype destinations', async () => {
    const user = userEvent.setup();
    renderRoute('/library');

    const projectList = screen.getByRole('list', { name: '我的作品' });
    const supportedLink = within(projectList).getByRole('link', { name: '雨夜电台' });
    expect(supportedLink).toHaveAttribute('href', '/project/rain-radio');
    expect(within(projectList).queryByRole('link', { name: '长安残梦' })).toBeNull();
    expect(within(projectList).queryByRole('link', { name: '零号航班' })).toBeNull();

    await user.click(screen.getByText('已归档作品（1）'));

    const archivedList = screen.getByRole('list', { name: '已归档作品（1）' });
    expect(within(archivedList).getByText('纸月亮')).toBeVisible();
    expect(within(archivedList).queryByRole('link', { name: '纸月亮' })).toBeNull();

    await user.click(supportedLink);

    expect(screen.getByRole('heading', { name: '雨夜电台' })).toBeVisible();
  });

  test('reveals archived projects only after opening the disclosure', async () => {
    const user = userEvent.setup();
    renderRoute('/library');

    expect(screen.getByText('纸月亮')).not.toBeVisible();

    await user.click(screen.getByText('已归档作品（1）'));

    expect(screen.getByText('纸月亮')).toBeVisible();
  });

  test('empty state has one New Novel action', () => {
    renderRoute('/library?state=empty');

    expect(screen.getByText('还没有作品')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '新建小说' })).toHaveLength(1);
  });
});

describe('new novel wizard', () => {
  test('retains core idea input while moving between named stages', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    const centralSituation = screen.getByLabelText('故事的核心处境是什么？');
    await user.clear(centralSituation);
    await user.type(centralSituation, '一名送餐员收到一台没有电源的收音机发来的求救。');
    await user.click(screen.getByRole('button', { name: '下一项' }));

    expect(screen.getByRole('heading', { name: '类型与读者' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('heading', { name: '核心创意' })).toBeVisible();
    expect(screen.getByLabelText('故事的核心处境是什么？')).toHaveValue(
      '一名送餐员收到一台没有电源的收音机发来的求救。'
    );
    expect(screen.queryByText(/步骤\s*1|Step\s*1/i)).toBeNull();
  }, 15_000);

  test('keeps every creative stage named', () => {
    renderRoute('/new');

    const stages = screen.getByRole('navigation', { name: '创作阶段' });
    for (const name of ['核心创意', '类型与读者', '主角', '世界观', '风格', '篇幅与章节计划', '确认创作简报', '故事圣经']) {
      expect(within(stages).getByRole('button', { name })).toBeVisible();
    }
  });

  test('keeps reader feeling and first-volume pacing independent', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    const feeling = screen.getByLabelText('前三章结束时，希望读者感受到什么？');
    await user.clear(feeling);
    await user.type(feeling, '读者情绪保持好奇和轻微不安');

    await user.click(screen.getByRole('button', { name: '篇幅与章节计划' }));
    const pacing = screen.getByLabelText('第一卷的推进节奏');
    await user.clear(pacing);
    await user.type(pacing, '前十章缓慢收紧，卷末连续揭示');

    await user.click(screen.getByRole('button', { name: '核心创意' }));
    expect(screen.getByLabelText('前三章结束时，希望读者感受到什么？')).toHaveValue(
      '读者情绪保持好奇和轻微不安'
    );

    await user.click(screen.getByRole('button', { name: '篇幅与章节计划' }));
    expect(screen.getByLabelText('第一卷的推进节奏')).toHaveValue(
      '前十章缓慢收紧，卷末连续揭示'
    );
  }, 15_000);

  test('review displays every collected creative decision', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    await user.click(screen.getByRole('button', { name: '确认创作简报' }));

    for (const decision of [
      '雨夜电台',
      '一名送餐员收到一台没有电源的收音机发来的求救。',
      '好奇、不安，并开始怀疑求救者的真实身份',
      '都市悬疑',
      '喜欢现实质感、慢热悬疑与人物关系的成年读者',
      '林澈',
      '查清失踪姐姐最后一晚送出的那份外卖去了哪里',
      '承认姐姐的失踪与自己当年的逃避有关',
      '一座沿江而建、老城区正在拆迁的南方城市',
      '收音机只在雨夜播出，并且每次求救都指向一处即将消失的地址',
      '克制、清晰，保留悬念',
      '雨夜的城市细节要具体，异常始终从日常缝隙里出现',
      '前十章建立异常规律，中段加快地址追踪，卷末揭示姐姐留下的线索',
      '240,000 字',
      '30 章'
    ]) {
      expect(screen.getByText(decision)).toBeVisible();
    }
  });

  test('moves focus to the new stage heading without focusing on initial render', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    expect(document.body).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '下一项' }));
    expect(screen.getByRole('heading', { name: '类型与读者' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('heading', { name: '核心创意' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '世界观' }));
    expect(screen.getByRole('heading', { name: '世界观' })).toHaveFocus();
  }, 15_000);

  test('offers an editable fixture Story Bible review', async () => {
    const user = userEvent.setup();
    renderRoute('/new');

    await user.click(screen.getByRole('button', { name: '故事圣经' }));

    expect(screen.getByRole('heading', { name: '审阅故事圣经' })).toBeVisible();
    const editor = screen.getByLabelText<HTMLTextAreaElement>('故事圣经草稿');
    expect(editor.value).toContain('林澈');

    await user.clear(editor);
    await user.type(editor, '# 改写后的故事圣经\n\n林澈决定追查最后一个地址。');

    expect(editor).toHaveValue('# 改写后的故事圣经\n\n林澈决定追查最后一个地址。');
    expect(screen.getByText('草稿，创建作品前仍可修改')).toBeVisible();
  });

  test('renders the wizard form as an unframed workflow', () => {
    const wizardRule = onboardingStyles.match(/\.nl-wizard-form\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(wizardRule).not.toMatch(/(?:^|\s)background\s*:/);
    expect(wizardRule).not.toMatch(/(?:^|\s)border\s*:/);
    expect(wizardRule).not.toMatch(/border-radius\s*:/);
  });
});
