import { expect, test, type Locator, type Page } from '@playwright/test';

type RouteFixture = {
  compactPrimaryControl?: string;
  focusControl?: string;
  heading: string;
  primaryControl: string;
  primaryRole?: 'button' | 'tab';
  route: string;
};

const routeFixtures: readonly RouteFixture[] = [
  { route: '/setup?state=ready', heading: '首次使用：准备就绪', primaryControl: '继续' },
  { route: '/setup?state=missing', heading: '首次使用：需要安装', primaryControl: '重新检查' },
  { route: '/library', heading: '作品库', primaryControl: '审阅第二章' },
  { route: '/new', heading: '新建作品', primaryControl: '下一项' },
  { route: '/project/rain-radio', heading: '雨夜电台', primaryControl: '审阅故事档案变更' },
  {
    route: '/project/rain-radio/chapter/2',
    heading: '第二章：收件地址',
    primaryControl: '比较修订',
    compactPrimaryControl: '打开本章写作提示'
  },
  { route: '/project/rain-radio/chapter/2/review', heading: '第二章检查结果', primaryControl: '比较修订' },
  { route: '/project/rain-radio/chapter/2/revision', heading: '比较第二章修订', primaryControl: '接受候选' },
  {
    route: '/project/rain-radio/chapter/2/commit-preview',
    heading: '审阅第二章的故事档案变更',
    primaryControl: '正式提交本章',
    focusControl: '返回本章'
  },
  { route: '/project/rain-radio/story-record', heading: '故事档案', primaryControl: '人物', primaryRole: 'tab' },
  { route: '/tasks?recovery=timeout', heading: '写作任务用时超过预期', primaryControl: '从上一个安全阶段继续' },
  { route: '/tasks?recovery=crash', heading: '上次关闭前有工作尚未结束', primaryControl: '查看恢复摘要' }
];

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }))).toEqual(expect.objectContaining({
    body: expect.any(Number),
    document: expect.any(Number)
  }));

  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
}

async function expectVisibleAndUnwrapped(control: Locator, requireNoWrap = false) {
  await expect(control).toBeVisible();
  if (requireNoWrap) await expect(control).toHaveCSS('white-space', 'nowrap');
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  await expect.poll(() => control.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function expectVisibleKeyboardFocus(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();

  const focusState = await control.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth)
    };
  });
  expect(focusState).toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: 2 });
}

async function expectLayoutHealth(
  page: Page,
  primaryControl: string,
  primaryRole: 'button' | 'tab' = 'button',
  focusControl = primaryControl
) {
  const heading = page.getByRole('heading').first();
  const primary = page.getByRole(primaryRole, { name: primaryControl, exact: true });
  const focusTarget = focusControl === primaryControl
    ? primary
    : page.getByRole('button', { name: focusControl, exact: true });

  await expect(heading).toBeVisible();
  await expectVisibleAndUnwrapped(primary);
  await expectVisibleKeyboardFocus(page, focusTarget);
  await expectNoHorizontalOverflow(page);

  const visibleButtons = page.locator('button.nl-button:visible');
  const count = await visibleButtons.count();
  for (let index = 0; index < count; index += 1) {
    await expectVisibleAndUnwrapped(visibleButtons.nth(index), true);
  }

  const [headingBox, primaryBox] = await Promise.all([heading.boundingBox(), primary.boundingBox()]);
  expect(headingBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  const overlap = headingBox!.x < primaryBox!.x + primaryBox!.width
    && headingBox!.x + headingBox!.width > primaryBox!.x
    && headingBox!.y < primaryBox!.y + primaryBox!.height
    && headingBox!.y + headingBox!.height > primaryBox!.y;
  expect(overlap).toBe(false);
}

test.describe('approved prototype routes remain usable at supported desktop sizes', () => {
  for (const fixture of routeFixtures) {
    test(`${fixture.route} keeps its author-facing controls readable`, async ({ page }) => {
      await page.goto(fixture.route);
      await expect(page.getByRole('heading', { name: fixture.heading, exact: true })).toBeVisible();
      const primaryControl = page.viewportSize()?.width === 1024 && fixture.compactPrimaryControl
        ? fixture.compactPrimaryControl
        : fixture.primaryControl;
      await expectLayoutHealth(page, primaryControl, fixture.primaryRole, fixture.focusControl);
    });
  }
});

test('Chapter Workspace Focus Mode preserves editing context at supported desktop sizes', async ({ page }) => {
  await page.goto('/project/rain-radio/chapter/2');
  await page.getByRole('button', { name: '进入专注模式' }).click();

  await expect(page.getByRole('navigation', { name: '章节导航' })).toBeHidden();
  await expect(page.getByRole('complementary', { name: '本章写作提示' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: '章节正文' })).toBeVisible();
  await expect(page.getByRole('status', { name: '当前任务' })).toBeVisible();
  await expectLayoutHealth(page, '退出专注模式');
});

test('revision comparison stacks changed passages at 1024 width', async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1024, 'This behavior applies only to the compact desktop viewport.');
  await page.goto('/project/rain-radio/chapter/2/revision');

  await expect(page.getByRole('region', { name: '并排比较' })).toBeVisible();
  await expect(page.locator('.nl-paragraph-diff__headings')).toBeHidden();
  await expect(page.locator('.nl-paragraph-diff__stack-heading').first()).toBeVisible();
  expect(await page.locator('.nl-paragraph-diff__row').first().evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ))).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('commit confirmation receives focus and returns it to its invoker', async ({ page }) => {
  await page.goto('/project/rain-radio/chapter/2/commit-preview');
  await page.getByRole('radio').first().check();
  const trigger = page.getByRole('button', { name: '正式提交本章' });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await dialog.getByRole('button', { name: '返回继续审阅' }).click();
  await expect(trigger).toBeFocused();
});

test('navigation drawer receives focus and returns it to its invoker', async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1024, 'The navigation drawer appears at the compact desktop viewport.');
  await page.goto('/project/rain-radio');
  const trigger = page.getByRole('button', { name: '打开作品导航' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: '雨夜电台' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await dialog.getByRole('button', { name: '关闭作品导航' }).click();
  await expect(trigger).toBeFocused();
});

test('diffs retain text labels for additions and removals without relying on color', async ({ page }) => {
  await page.goto('/project/rain-radio/chapter/2/revision');
  await expect(page.getByText('已删除').first()).toBeVisible();
  await expect(page.getByText('已新增').first()).toBeVisible();
});

test('icon-only controls expose both accessible names and tooltips', async ({ page }) => {
  await page.goto('/project/rain-radio/chapter/2');
  const iconButtons = page.locator('button.nl-icon-button');
  expect(await iconButtons.count()).toBeGreaterThan(0);

  for (let index = 0; index < await iconButtons.count(); index += 1) {
    const button = iconButtons.nth(index);
    await expect(button).toHaveAttribute('aria-label', /.+/);
    await expect(button).toHaveAttribute('title', /.+/);
  }
});

test('reduced motion overrides transitions and animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/library');
  await page.addStyleTag({
    content: `
      @keyframes visual-motion-probe { from { opacity: 0; } to { opacity: 1; } }
      .visual-motion-probe { animation: visual-motion-probe 2s infinite; transition: opacity 2s ease; }
    `
  });
  await page.locator('body').evaluate((body) => {
    const probe = document.createElement('div');
    probe.className = 'visual-motion-probe';
    body.append(probe);
  });

  const motion = await page.locator('.visual-motion-probe').evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animationDuration: styles.animationDuration, iterationCount: styles.animationIterationCount, transitionDuration: styles.transitionDuration };
  });
  expect(Number.parseFloat(motion.animationDuration)).toBeCloseTo(0.00001);
  expect(motion.iterationCount).toBe('1');
  expect(Number.parseFloat(motion.transitionDuration)).toBeCloseTo(0.00001);
});
