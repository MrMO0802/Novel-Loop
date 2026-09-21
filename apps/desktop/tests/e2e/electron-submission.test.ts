import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const execFile = promisify(execFileCallback);
const desktopRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const electronExecutable = require('electron') as string;
const projectId = 'desktop-submission-e2e';
const projectKey = 'project_desktop_submission_e2e';
const title = 'Electron Submission Test';

// Match the existing smoke harness: a required run fails, never disables sandboxing.
function secureSandboxBlocker(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const sandbox = statSync(path.join(path.dirname(electronExecutable), 'chrome-sandbox'));
    if (sandbox.uid === 0 && (sandbox.mode & 0o4000) === 0o4000) return null;
  } catch { /* A permitted user-namespace sandbox needs no SUID helper. */ }
  const setting = (name: string) => {
    try { return readFileSync(`/proc/sys/kernel/${name}`, 'utf8').trim(); }
    catch { return null; }
  };
  if (setting('unprivileged_userns_clone') === '1'
    && setting('apparmor_restrict_unprivileged_userns') !== '1') return null;
  return 'Secure Electron sandbox is unavailable; insecure sandbox flags are forbidden.';
}

function environment(codexBin: string): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
        && !['ELECTRON_RENDERER_URL', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE'].includes(entry[0])
    )),
    NLE_CODEX_BIN: codexBin
  };
}

async function launch(userData: string, codexBin: string): Promise<ElectronApplication> {
  // Readiness resolves PATH independently of the provider's NLE_CODEX_BIN.
  // A private PATH prevents either path from reaching the user's real Codex.
  const bin = await mkdtemp(path.join(path.dirname(userData), 'launch-bin-'));
  await symlink(codexBin, path.join(bin, 'codex'));
  await symlink(process.execPath, path.join(bin, 'node'));
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, desktopRoot],
    chromiumSandbox: true, cwd: desktopRoot, env: { ...environment(codexBin), PATH: bin }
  });
  expect(app.process().spawnargs.some(arg => /^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/u.test(arg))).toBe(false);
  expect(await app.evaluate(({ app: main }) => main.getPath('userData'))).toBe(userData);
  return app;
}

async function runModule(source: string, codexBin?: string): Promise<string> {
  const result = await execFile(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: repositoryRoot, env: codexBin ? environment(codexBin) : process.env,
    timeout: 60_000, maxBuffer: 4 * 1024 * 1024
  });
  return result.stdout;
}

async function fakeHelperUrl(): Promise<string> {
  // Playwright is CJS. Transpile only the existing self-contained fake helper;
  // load the built engine in a separate ESM process, not through CJS require().
  const fakeSource = transpileModule(await readFile(path.join(repositoryRoot, 'tests/helpers/fakeCodex.ts'), 'utf8'), {
    compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 }
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(fakeSource).toString('base64')}`;
}

type FailureMode = 'codex-controlled-diagnostics-fail' | 'jsonl-usage-limit';

async function writeFailureFake(root: string, mode: FailureMode) {
  const output = await runModule(`
    import { writeFakeCodex } from ${JSON.stringify(await fakeHelperUrl())};
    console.log(JSON.stringify(await writeFakeCodex(${JSON.stringify(root)}, ${JSON.stringify(mode)})));
  `);
  return JSON.parse(output.trim()) as { codexBin: string; argsLogPath: string };
}

async function seed(root: string) {
  const helper = await fakeHelperUrl();
  const projectsRoot = path.join(root, 'projects');
  const projectRoot = path.join(projectsRoot, projectId);
  const userData = path.join(root, 'user-data');
  await mkdir(projectsRoot);
  await mkdir(userData);
  const output = await runModule(`
    import { writeFakeCodex } from ${JSON.stringify(helper)};
    import { initProjectFromBriefText } from './dist/app/initProject.js';
    import { buildBible } from './dist/app/buildBible.js';
    import { planGlobal } from './dist/app/planGlobal.js';
    import { runChapterDryRun } from './dist/app/chapterPlanning.js';
    import { runChapterUntilDraft } from './dist/app/chapterDrafting.js';
    const fake = await writeFakeCodex(${JSON.stringify(root)}, 'codex-controlled-valid');
    const input = { projectId: ${JSON.stringify(projectId)}, projectsRoot: ${JSON.stringify(projectsRoot)},
      provider: 'codex-text', codexBin: fake.codexBin, codexProfile: 'clean',
      promptRoot: ${JSON.stringify(path.join(repositoryRoot, 'prompts'))} };
    await initProjectFromBriefText({ ...input, brief: '# ${title}\\n\\nAn impossible radio signal leads to an abandoned building.\\n' });
    await buildBible(input);
    await planGlobal(input);
    await runChapterDryRun({ ...input, chapterNumber: 1 });
    await runChapterUntilDraft({ ...input, chapterNumber: 1 });
    console.log(JSON.stringify(fake));
  `);
  const fake = JSON.parse(output.trim()) as { codexBin: string; argsLogPath: string };
  const timestamp = '2026-09-21T00:00:00.000Z';
  await writeFile(path.join(userData, 'project-library.json'), JSON.stringify({
    schemaVersion: 1, defaultLibraryRoot: projectsRoot,
    projects: [{ projectKey, projectRoot, title, addedAt: timestamp, lastOpenedAt: timestamp }]
  }));
  return { ...fake, projectsRoot, projectRoot, userData };
}

async function openProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: '进入作品库' }).click();
  await page.getByRole('button', { name: `打开《${title}》` }).click();
}

async function openDraft(page: Page): Promise<void> {
  await openProject(page);
  await page.getByRole('button', { name: '打开第 1 章初稿' }).click();
}

async function calls(codexBin: string): Promise<string[]> {
  const text = await readFile(`${codexBin}.stdin.ndjson`, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: false });
}

async function viewportReview(page: Page): Promise<void> {
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    const check = page.getByRole('checkbox', { name: '我已审阅正文版本和全部故事变化' });
    const submit = page.getByRole('button', { name: '正式提交第 1 章', exact: true });
    await expect(check).toBeInViewport();
    await expect(submit).toBeInViewport();
    await expect(submit).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot(page, `submission-review-${size.width}x${size.height}.png`);
  }
}

test('explicit UI save/adopt B, check, restart, human confirmation, exact commit and next chapter', async () => {
  test.setTimeout(180_000);
  const blocker = secureSandboxBlocker();
  if (blocker && process.env['NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE'] === '1') throw new Error(blocker);
  test.skip(blocker !== null, blocker ?? '');
  const root = await mkdtemp(path.join(tmpdir(), 'novel-loop-electron-submission-'));
  let app: ElectronApplication | null = null;
  try {
    const fixture = await seed(root);
    const chapter = path.join(fixture.projectRoot, 'chapters/chapter_001');
    const statePath = path.join(fixture.projectRoot, 'state/story_state.json');
    const queuePath = path.join(fixture.projectRoot, 'planning/chapter_queue.json');
    const original = await readFile(path.join(chapter, 'draft_v1.md'));
    const stateBefore = await readFile(statePath);
    const queueBefore = await readFile(queuePath);
    const adopted = `${original.toString('utf8')}\nDESKTOP_SUBMISSION_ADOPTED_B: The witness kept the blue receipt.\n`;
    app = await launch(fixture.userData, fixture.codexBin);
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDraft(page);
    await page.getByRole('textbox', { name: '章节正文' }).fill(adopted);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.getByRole('button', { name: '采用此修订' }).click();
    await page.getByRole('button', { name: '确认采用', exact: true }).click();
    await expect(page.getByText('修订已采用，尚未正式提交。')).toBeVisible();
    expect(await readFile(statePath)).toEqual(stateBefore);
    expect(await readFile(queuePath)).toEqual(queueBefore);
    expect(await readFile(path.join(chapter, 'draft_v1.md'))).toEqual(original);
    const beforeCheck = await calls(fixture.codexBin);
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始检查', exact: true })).toBeVisible();
    expect(await calls(fixture.codexBin)).toEqual(beforeCheck);
    await page.getByRole('button', { name: '开始检查', exact: true }).click();
    await expect(page.getByRole('heading', { name: '审阅第 1 章提交内容' })).toBeVisible({ timeout: 45_000 });
    const afterCheck = await calls(fixture.codexBin);
    const checkCalls = afterCheck.slice(beforeCheck.length);
    expect(checkCalls).toHaveLength(2);
    expect(checkCalls.map(prompt => /PROMPT_ID:\s*([^\n]+)/u.exec(prompt)?.[1])).toEqual([
      'diagnostics.diagnose_chapter_slim', 'memory.extract_canon_patch_proposal_slim'
    ]);
    for (const prompt of checkCalls) expect(prompt).toContain(adopted);
    expect(await readFile(statePath)).toEqual(stateBefore);
    expect(await readFile(queuePath)).toEqual(queueBefore);
    expect(await readdir(chapter)).not.toContain('final.md');
    await viewportReview(page);
    await app.close();
    app = null;

    // Restart may restore a preview, never the author's checkbox authorization.
    app = await launch(fixture.userData, fixture.codexBin);
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1024, height: 768 });
    await openDraft(page);
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await expect(page.getByRole('heading', { name: '审阅第 1 章提交内容' })).toBeVisible();
    const reviewed = page.getByRole('checkbox', { name: '我已审阅正文版本和全部故事变化' });
    await expect(reviewed).not.toBeChecked();
    const submit = page.getByRole('button', { name: '正式提交第 1 章', exact: true });
    await expect(submit).toBeDisabled();
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    await reviewed.check();
    await submit.click();
    const dialog = page.getByRole('dialog', { name: '确认正式提交第 1 章？' });
    const safeAction = dialog.getByRole('button', { name: '继续审阅' });
    const confirm = dialog.getByRole('button', { name: '确认正式提交', exact: true });
    await expect(safeAction).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(safeAction).toBeFocused();
    await screenshot(page, 'submission-confirm-1024x768.png');
    await page.keyboard.press('Escape');
    await expect(submit).toBeFocused();
    expect(await readFile(statePath)).toEqual(stateBefore);
    await submit.click();
    await confirm.click();
    await expect(page.getByRole('heading', { name: '第 1 章已正式提交' })).toBeVisible({ timeout: 15_000 });
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    expect(await readFile(path.join(chapter, 'final.md'))).toEqual(Buffer.from(adopted));
    expect(await readFile(path.join(chapter, 'draft_v1.md'))).toEqual(original);
    expect(JSON.parse(await readFile(statePath, 'utf8')).latestCommittedChapter).toBe(1);
    const queue = JSON.parse(await readFile(queuePath, 'utf8')) as { chapters: Array<{ chapterNumber: number; status: string }> };
    expect(queue.chapters.filter(entry => entry.status === 'committed')).toEqual([
      expect.objectContaining({ chapterNumber: 1 })
    ]);
    const report = JSON.parse(await readFile(path.join(chapter, 'commit_report.json'), 'utf8'));
    expect(report.appliedChanges.latestCommittedChapter).toEqual({ from: 0, to: 1 });
    for (const snapshot of [report.beforeSnapshot, report.afterSnapshot]) {
      expect(await readFile(path.join(fixture.projectRoot, 'snapshots', `${snapshot.snapshotId}.json`), 'utf8')).toBeTruthy();
    }
    const journal = JSON.parse(await readFile(path.join(chapter, 'commit_journal_v1.json'), 'utf8'));
    expect(journal.commitKind).toBe('desktop_controlled_commit');
    expect(journal.phases.map((phase: { phase: string }) => phase.phase)).toContain('completed');
    const committedState = await readFile(statePath);
    const committedQueue = await readFile(queuePath);
    await screenshot(page, 'submission-committed-1024x768.png');
    await page.getByRole('button', { name: '创作下一章', exact: true }).click();
    await expect(page.getByRole('heading', { name: '准备第 2 章方向', exact: true })).toBeVisible();
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    await app.close();
    app = null;

    app = await launch(fixture.userData, fixture.codexBin);
    page = await app.firstWindow();
    await openProject(page);
    const recovered = await page.evaluate(key => window.novelLoop.submission.readPreview({ projectKey: key }), projectKey);
    expect(recovered).toEqual({ outcome: 'committed', chapterNumber: 1, latestCommittedChapter: 1, hasNextChapter: true });
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    expect(await readFile(statePath)).toEqual(committedState);
    expect(await readFile(queuePath)).toEqual(committedQueue);
    // The refreshed overview offers the next chapter directly, without generation.
    await page.getByRole('button', { name: '创建第 2 章', exact: true }).click();
    await expect(page.getByRole('heading', { name: '准备第 2 章方向' })).toBeVisible();
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    expect(await readFile(statePath)).toEqual(committedState);
    const validation = JSON.parse(await runModule(`
      import { validateProject } from './dist/app/validateProject.js';
      import { auditProject } from './dist/app/projectAudit.js';
      const input = ${JSON.stringify({ projectId, projectsRoot: fixture.projectsRoot })};
      console.log(JSON.stringify({ validate: await validateProject(input), audit: await auditProject({ ...input, strict: true, fixIndex: true }) }));
    `, fixture.codexBin));
    expect(validation.validate.ok, JSON.stringify(validation.validate)).toBe(true);
    expect(validation.audit.ok, JSON.stringify(validation.audit.report)).toBe(true);
    expect(await calls(fixture.codexBin)).toEqual(afterCheck);
    const argumentsLog = await readFile(fixture.argsLogPath, 'utf8');
    expect(argumentsLog).not.toMatch(/workspace-write|danger-full-access|--yolo|--dangerously-bypass/u);
    for (const line of argumentsLog.split('\n').filter(line => /\bexec\b/u.test(line))) {
      expect(line).toContain('--sandbox read-only');
      expect(line).toContain('--ask-for-approval never');
    }
  } finally {
    if (app) await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function protectedBytes(projectRoot: string) {
  return {
    state: await readFile(path.join(projectRoot, 'state/story_state.json')),
    queue: await readFile(path.join(projectRoot, 'planning/chapter_queue.json')),
    original: await readFile(path.join(projectRoot, 'chapters/chapter_001/draft_v1.md'))
  };
}

async function expectNotCommitted(projectRoot: string, before: Awaited<ReturnType<typeof protectedBytes>>) {
  expect(await protectedBytes(projectRoot)).toEqual(before);
  const files = await readdir(path.join(projectRoot, 'chapters/chapter_001'));
  expect(files.filter(name => /^(?:final\.md|canon_patch\.json|commit_report\.json|commit_journal_v\d+\.json)$/u.test(name))).toEqual([]);
  expect(await readdir(path.join(projectRoot, 'snapshots'))).toEqual([]);
}

async function expectNoApproval(page: Page) {
  await expect(page.getByRole('checkbox', { name: '我已审阅正文版本和全部故事变化' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '正式提交第 1 章', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认正式提交', exact: true })).toHaveCount(0);
}

async function submissionTasks(projectRoot: string) {
  const runs = path.join(projectRoot, 'runs');
  const tasks: Array<{ taskId: string; status: string; safeErrorCode: string | null }> = [];
  for (const entry of await readdir(runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskPath = path.join(runs, entry.name, 'submission_task.json');
    if (await exists(taskPath)) tasks.push(JSON.parse(await readFile(taskPath, 'utf8')));
  }
  return tasks;
}

// Only the temporary fake process is held; the production IPC/backend is unmodified.
async function heldFake(root: string, delegate: string) {
  const codexBin = path.join(root, 'held-codex.cjs');
  const entered = path.join(root, 'diagnostics-entered');
  const release = path.join(root, 'diagnostics-release');
  const exited = path.join(root, 'diagnostics-exited');
  await writeFile(codexBin, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const input = args.includes('exec') ? fs.readFileSync(0, 'utf8') : '';
const held = input.includes('PROMPT_ID: diagnostics.diagnose_chapter_slim');
try {
  if (held) {
    fs.writeFileSync(${JSON.stringify(entered)}, 'entered');
    const deadline = Date.now() + 45000;
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) throw new Error('Temporary fake release deadline exceeded');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  const result = spawnSync(process.execPath, [${JSON.stringify(delegate)}, ...args], { input, encoding: 'utf8', timeout: 10000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
} finally {
  if (held) fs.writeFileSync(${JSON.stringify(exited)}, 'exited');
}
`);
  await chmod(codexBin, 0o755);
  return { codexBin, entered, release, exited };
}

async function exists(file: string): Promise<boolean> {
  return readFile(file).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

type Seed = Awaited<ReturnType<typeof seed>>;
async function withFailureDraft(
  mode: FailureMode | 'valid' | 'held',
  run: (context: {
    fixture: Seed; page: Page; logBin: string;
    before: Awaited<ReturnType<typeof protectedBytes>>;
    hold: Awaited<ReturnType<typeof heldFake>> | null;
  }) => Promise<void>
) {
  test.setTimeout(120_000);
  const blocker = secureSandboxBlocker();
  if (blocker && process.env['NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE'] === '1') throw new Error(blocker);
  test.skip(blocker !== null, blocker ?? '');
  const root = await mkdtemp(path.join(tmpdir(), 'novel-loop-electron-submission-failure-'));
  let app: ElectronApplication | null = null;
  let hold: Awaited<ReturnType<typeof heldFake>> | null = null;
  try {
    const fixture = await seed(root);
    const fake = mode === 'valid' || mode === 'held' ? fixture : await writeFailureFake(root, mode);
    if (mode === 'held') hold = await heldFake(root, fake.codexBin);
    const before = await protectedBytes(fixture.projectRoot);
    app = await launch(fixture.userData, hold?.codexBin ?? fake.codexBin);
    const page = await app.firstWindow();
    await openDraft(page);
    await run({ fixture, page, logBin: fake.codexBin, before, hold });
  } finally {
    // Release and drain a held fake even if an assertion fails; never leave it waiting.
    try {
      if (hold) {
        await writeFile(hold.release, 'release');
        if (await exists(hold.entered)) await expect.poll(() => exists(hold!.exited), { timeout: 15_000 }).toBe(true);
      }
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }
}

for (const scenario of [
  { mode: 'codex-controlled-diagnostics-fail', message: '检查未通过，请核对下列问题后返回修改。', code: 'diagnostics_failed', maxAttempts: 1 },
  { mode: 'jsonl-usage-limit', message: '本次检查已达到使用额度，请稍后重新检查。', code: 'usage_limit', maxAttempts: 2 }
] as const) {
  test(`explicit check fails safely with ${scenario.mode}, bounded attempts and no UI retry`, async () => {
    await withFailureDraft(scenario.mode, async ({ fixture, page, logBin, before }) => {
      await page.getByRole('button', { name: '检查并提交', exact: true }).click();
      await expect(page.getByRole('button', { name: '开始检查', exact: true })).toBeVisible();
      expect(await calls(logBin)).toEqual([]);
      await page.getByRole('button', { name: '开始检查', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(scenario.message, { timeout: 30_000 });
      await expect(page.locator('body')).not.toContainText(fixture.projectRoot);
      await expect(page.locator('body')).not.toContainText('sk-SECRET');
      await expect(page.locator('body')).not.toContainText('/home/user/.codex/auth.json');
      await expectNoApproval(page);
      const failedCalls = await calls(logBin);
      // Preserve the existing provider retry bound, distinct from starting another UI task.
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);
      expect(failedCalls.length).toBeLessThanOrEqual(scenario.maxAttempts);
      for (const prompt of failedCalls) expect(prompt).toContain('PROMPT_ID: diagnostics.diagnose_chapter_slim');
      const tasks = await submissionTasks(fixture.projectRoot);
      expect(tasks).toHaveLength(1);
      const task = tasks[0]!;
      expect(task.safeErrorCode).toBe(scenario.code);
      expect(['running', 'cancel_requested', 'ready']).not.toContain(task.status);
      const terminal = await page.evaluate(taskId => window.novelLoop.submission.get({ taskId }), task.taskId);
      expect(terminal.safeErrorCode).toBe(scenario.code);
      await page.evaluate(key => window.novelLoop.submission.readPreview({ projectKey: key }), projectKey);
      await expectNotCommitted(fixture.projectRoot, before);
      // Observe more than one polling interval without clicking retry.
      await page.waitForTimeout(1_600);
      expect(await calls(logBin)).toEqual(failedCalls);
      expect(await submissionTasks(fixture.projectRoot)).toEqual(tasks);
      await expectNoApproval(page);
      await page.getByRole('button', { name: '返回修改', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '章节正文' })).toBeVisible();
      expect(await calls(logBin)).toEqual(failedCalls);
      expect(await submissionTasks(fixture.projectRoot)).toEqual(tasks);
      await expectNotCommitted(fixture.projectRoot, before);
    });
  });
}

test('autosaved unadopted prose blocks the UI and main boundary; adopting a new version invalidates the old preview', async () => {
  await withFailureDraft('valid', async ({ fixture, page, logBin, before }) => {
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await page.getByRole('button', { name: '开始检查', exact: true }).click();
    await expect(page.getByRole('heading', { name: '审阅第 1 章提交内容' })).toBeVisible({ timeout: 30_000 });
    const preview = await page.evaluate(key => window.novelLoop.submission.readPreview({ projectKey: key }), projectKey);
    expect(preview.outcome).toBe('ready');
    if (preview.outcome !== 'ready') throw new Error('Expected a ready preview');
    const checkedCalls = await calls(logBin);
    await page.getByRole('button', { name: '返回修改', exact: true }).click();
    await page.getByRole('tab', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '章节正文' });
    const changed = `${await editor.inputValue()}\nUNADOPTED_C: The receipt was red, not blue.\n`;
    await editor.fill(changed);
    const entry = page.getByRole('button', { name: '检查并提交', exact: true });
    await expect(entry).toBeDisabled();
    // Do not manually save: exercise autosave leaving an unadopted working copy.
    await expect(page.getByRole('status')).toHaveText('已自动保存', { timeout: 10_000 });
    await expect(entry).toBeDisabled();
    const pending = await page.evaluate(key => window.novelLoop.submission.readPreview({ projectKey: key }), projectKey);
    expect(pending).toMatchObject({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
    const request = { projectKey, previewToken: preview.previewToken, confirm: true as const };
    expect(await page.evaluate(input => window.novelLoop.submission.confirm(input), request))
      .toEqual({ outcome: 'blocked', messageKey: 'submission.working_copy_pending' });
    expect(await calls(logBin)).toEqual(checkedCalls);
    await expectNotCommitted(fixture.projectRoot, before);
    await page.getByRole('button', { name: '采用此修订' }).click();
    await page.getByRole('button', { name: '确认采用', exact: true }).click();
    await expect(page.getByText('修订已采用，尚未正式提交。')).toBeVisible();
    await entry.click();
    await expect(page.getByRole('alert')).toContainText('正文或故事档案已变化，请重新检查。');
    await expectNoApproval(page);
    expect(await page.evaluate(input => window.novelLoop.submission.confirm(input), request))
      .toEqual({ outcome: 'stale', messageKey: 'submission.stale' });
    expect(await calls(logBin)).toEqual(checkedCalls);
    await expectNotCommitted(fixture.projectRoot, before);
  });
});

test('cancelling a held fake check stops at the safe boundary without a patch or commit', async () => {
  await withFailureDraft('held', async ({ fixture, page, logBin, before, hold }) => {
    if (!hold) throw new Error('Expected a held fake');
    const beforeCalls = await calls(logBin);
    await page.getByRole('button', { name: '检查并提交', exact: true }).click();
    await page.getByRole('button', { name: '开始检查', exact: true }).click();
    await expect.poll(() => exists(hold.entered), { timeout: 15_000 }).toBe(true);
    await page.getByRole('button', { name: '完成当前安全步骤后停止', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已请求停止');
    await expectNoApproval(page);
    await expectNotCommitted(fixture.projectRoot, before);
    await writeFile(hold.release, 'release');
    await expect(page.getByRole('status')).toContainText('检查已停止，正文和正式故事档案没有改变。', { timeout: 15_000 });
    await expectNoApproval(page);
    const afterCalls = await calls(logBin);
    expect(afterCalls.slice(beforeCalls.length)).toHaveLength(1);
    expect(afterCalls[beforeCalls.length]).toContain('PROMPT_ID: diagnostics.diagnose_chapter_slim');
    await page.waitForTimeout(1_600);
    expect(await calls(logBin)).toEqual(afterCalls);
    await expectNotCommitted(fixture.projectRoot, before);
  });
});
