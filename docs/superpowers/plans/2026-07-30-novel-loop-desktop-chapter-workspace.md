# Novel Loop Desktop Chapter Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable an author to create the next chapter, review its generated direction, explicitly approve drafting, and read `draft_v1.md` in the secure Electron desktop application.

**Architecture:** Reuse `runChapterDryRun` and `runChapterUntilDraft` as the only business pipelines, adding lifecycle hooks for progress and cooperative stop. Add a filtered engine desktop boundary, one main-process chapter task service, fixed strict IPC/preload methods, and author-facing React routes for planning, plan review, draft generation, and draft reading.

**Tech Stack:** Node.js 20+, TypeScript strict mode, Zod, Electron, React, Vite, Vitest, Playwright, pnpm, local `codex-text`.

## Global Constraints

- Target chapter is always `latestCommittedChapter + 1`; the renderer cannot choose an arbitrary chapter number.
- Desktop generation always uses `codex-text`; renderer input cannot select a provider, command, prompt, schema, path, or shell option.
- Codex remains sandboxed `read-only`; no workspace write is enabled.
- Story State must remain byte-for-byte unchanged through planning and drafting.
- Planning and drafting may update only the existing non-canonical chapter queue lifecycle.
- Drafting begins only after an explicit author confirmation from a complete plan review.
- Stop is cooperative before the next provider call; completed valid artifacts remain reusable.
- Renderer payloads contain no absolute/relative artifact paths, run IDs, queue internals, raw JSON, JSONL, auth data, or Codex arguments.
- All shared IPC request/response schemas are strict Zod schemas with bounded strings, arrays, Markdown bytes, and total payload bytes.
- This milestone must not generate diagnostics, revision candidates, `final.md`, canon patches, state diffs, snapshots, approvals, or commit reports.
- No DeepSeek, OpenAI API, Web UI, CodexAgentConnector, historical recommit, stale regeneration, or conflict repair.
- Manual draft editing and autosave remain outside this milestone.

---

### Task 1: Add Recoverable Chapter Planning And Drafting Lifecycles

**Files:**
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Test: `tests/integration/chapterPlanningDryRun.test.ts`
- Test: `tests/integration/chapterDraft.test.ts`
- Create: `tests/integration/chapterDesktopLifecycle.test.ts`

**Interfaces:**
- Produces:

```ts
export type ChapterPlanningProgressStage =
  | 'preparing'
  | 'mission'
  | 'plan_candidates'
  | 'ranking'
  | 'finalizing'
  | 'completed';

export interface ChapterPlanningProgressEvent {
  stage: ChapterPlanningProgressStage;
  state: 'started' | 'completed';
}

export type ChapterDraftProgressStage =
  | 'preparing'
  | 'scene_cards'
  | 'scene_drafts'
  | 'draft_assembly'
  | 'finalizing'
  | 'completed';

export interface ChapterDraftProgressEvent {
  stage: ChapterDraftProgressStage;
  state: 'started' | 'completed' | 'progress';
  current?: number;
  total?: number;
}
```

- Extends `ChapterDryRunInput` and `ChapterDraftingInput` with:

```ts
onProgress?: (event: ChapterPlanningProgressEvent | ChapterDraftProgressEvent) =>
  void | Promise<void>;
shouldStop?: () => boolean | Promise<boolean>;
```

- Cancellation errors:
  - `CHAPTER_PLANNING_CANCELLED`
  - `CHAPTER_DRAFT_CANCELLED`

- [ ] **Step 1: Write failing lifecycle and state-protection tests**

Add tests that collect progress events and assert:

```ts
expect(events).toEqual([
  'preparing:started',
  'preparing:completed',
  'mission:started',
  'mission:completed',
  'plan_candidates:started',
  'plan_candidates:completed',
  'ranking:started',
  'ranking:completed',
  'finalizing:started',
  'finalizing:completed',
  'completed:completed'
]);
expect(await sha256(paths.storyState())).toBe(beforeStateHash);
```

For drafting, assert `scene_drafts:progress` reports `current` values from `1`
through `total` and that no post-draft canonical artifacts exist.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
corepack pnpm vitest run \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts
```

Expected: FAIL because lifecycle callbacks and cancellation contracts do not
exist.

- [ ] **Step 3: Add ordered progress emission and cooperative stop**

Implement helpers with exact behavior:

```ts
async function emitProgress(
  callback: ChapterDryRunInput['onProgress'],
  event: ChapterPlanningProgressEvent
): Promise<void> {
  await callback?.(event);
}

async function stopIfRequested(
  input: Pick<ChapterDryRunInput, 'shouldStop'>,
  code: 'CHAPTER_PLANNING_CANCELLED' | 'CHAPTER_DRAFT_CANCELLED'
): Promise<void> {
  if (await input.shouldStop?.()) {
    throw new AppError(code, 'Chapter task stopped before the next generation step.', 2);
  }
}
```

Call `stopIfRequested` before mission, candidate generation, ranking, scene-card
generation, every scene provider call, and draft assembly. Emit completion only
after the corresponding validated artifact is available.

- [ ] **Step 4: Make cancellation recoverable without adding a queue status**

Retain the existing queue `failed` state for interrupted partial work, but:

- record run errors with `recoverable: true` for the two cancellation codes;
- end the run as failed without deleting artifacts;
- allow a later normal rerun to reuse valid artifacts;
- keep all other failures unchanged.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```bash
corepack pnpm vitest run \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/e2e/idempotency.test.ts \
  tests/e2e/failureInjection.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/chapterPlanning.ts src/app/chapterDrafting.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts
git commit -m "feat(engine): add recoverable chapter task lifecycle"
```

---

### Task 2: Add The Filtered Desktop Chapter Engine Boundary

**Files:**
- Create: `src/desktop/chapterWorkspace.ts`
- Modify: `src/desktop/index.ts`
- Create: `tests/unit/desktopChapterWorkspace.test.ts`

**Interfaces:**
- Consumes lifecycle types and functions from Task 1.
- Produces:

```ts
export interface DesktopChapterPlanningInput {
  projectRoot: string;
  onProgress?: (event: ChapterPlanningProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface DesktopChapterDraftingInput {
  projectRoot: string;
  onProgress?: (event: ChapterDraftProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
}

export type DesktopNextChapterInspection =
  | { available: false; reason: 'global_plan_missing' | 'chapter_missing' }
  | {
      available: true;
      chapterNumber: number;
      title: string;
      phase:
        | 'not_started'
        | 'planning_partial'
        | 'plan_ready'
        | 'drafting_partial'
        | 'draft_ready';
    };

export async function inspectDesktopNextChapter(
  input: { projectRoot: string }
): Promise<DesktopNextChapterInspection>;

export async function planDesktopNextChapter(
  input: DesktopChapterPlanningInput
): Promise<{ chapterNumber: number; completed: true }>;

export async function readDesktopChapterPlan(
  input: { projectRoot: string }
): Promise<DesktopChapterPlanReview>;

export async function draftDesktopNextChapter(
  input: DesktopChapterDraftingInput
): Promise<{ chapterNumber: number; completed: true }>;

export async function readDesktopChapterDraft(
  input: { projectRoot: string }
): Promise<DesktopChapterDraftReview>;
```

- [ ] **Step 1: Write failing desktop-boundary tests**

Test real temporary projects and assert:

```ts
expect(inspection.chapterNumber).toBe(storyState.latestCommittedChapter + 1);
expect(capturedProvider).toBe('codex-text');
expect(JSON.stringify(planReview)).not.toMatch(
  /artifactPath|runId|latestRunId|selectedPlanPath|plan_candidates|story_state/
);
expect(JSON.stringify(draftReview)).not.toMatch(
  /artifactPath|runId|contextManifest|scene_cards\.json|draft_v1\.md/
);
expect(await sha256(paths.storyState())).toBe(beforeStateHash);
```

Also assert stale, already-committed, sequence-gap, missing queue item, oversized
Markdown, non-file artifacts, and invalid JSON fail closed.

- [ ] **Step 2: Run and verify RED**

```bash
corepack pnpm vitest run tests/unit/desktopChapterWorkspace.test.ts
```

Expected: FAIL because `chapterWorkspace.ts` is absent.

- [ ] **Step 3: Implement next-chapter inspection and sequence validation**

Resolve project identity from `path.resolve(input.projectRoot)`, read
`StoryStateSchema` and `ChapterQueueSchema`, calculate
`latestCommittedChapter + 1`, and reject:

```ts
if (queueItem.status === 'stale_due_to_history_edit') {
  throw new AppError(
    'DESKTOP_CHAPTER_STALE',
    'The next chapter requires the history-edit recovery flow.',
    2
  );
}
```

Determine the five public phases from schema-valid artifact sets, using the
queue only as a consistency check. Missing artifacts after application restart
must route to the last valid phase; an invalid present artifact fails closed
instead of being treated as absent. Do not return raw status or stage.

- [ ] **Step 4: Implement pinned-provider planning and drafting**

Call:

```ts
await runChapterDryRun({
  projectId,
  projectsRoot,
  chapterNumber,
  provider: 'codex-text',
  candidates: 3,
  onProgress: input.onProgress,
  shouldStop: input.shouldStop
});
```

and:

```ts
await runChapterUntilDraft({
  projectId,
  projectsRoot,
  chapterNumber,
  provider: 'codex-text',
  onProgress: input.onProgress,
  shouldStop: input.shouldStop
});
```

Do not pass commit, force-stage, regenerate-stale, prompt roots, fixture roots,
or renderer-controlled Codex options.

- [ ] **Step 5: Implement bounded author-facing reads**

Use `lstat` before reads, existing Zod schemas for JSON, and UTF-8 byte limits:

- selected plan and draft: 2 MiB each;
- candidate excerpt: 2,000 characters;
- at most 10 alternatives;
- at most 100 mission objectives;
- at most 100 scene summaries;
- total serialized review payload: 4 MiB.

Derive candidate titles from the first Markdown heading and excerpts from the
first non-heading paragraph. Return ranking strengths/risks but never numeric
scores or candidate IDs.

- [ ] **Step 6: Verify GREEN and commit**

```bash
corepack pnpm vitest run \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/unit/desktopGlobalPlanning.test.ts \
  tests/e2e/codexTextProviderSafetyGate.test.ts
git add src/desktop/chapterWorkspace.ts src/desktop/index.ts \
  tests/unit/desktopChapterWorkspace.test.ts
git commit -m "feat(engine): expose desktop chapter workspace boundary"
```

---

### Task 3: Add Strict Chapter Contracts And Main-Process Task Service

**Files:**
- Create: `apps/desktop/src/shared/chapterContract.ts`
- Create: `apps/desktop/src/main/chapter/EngineChapterGateway.ts`
- Create: `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- Create: `apps/desktop/tests/main/chapterContract.test.ts`
- Create: `apps/desktop/tests/main/projectChapterService.test.ts`
- Create: `apps/desktop/tests/main/chapterStateProtection.test.ts`

**Interfaces:**
- Consumes Task 2 desktop exports.
- Produces:

```ts
export interface ChapterApplicationService {
  inspect(projectKey: string): Promise<ChapterInspection>;
  startPlanning(projectKey: string): Promise<ChapterTask>;
  startDrafting(projectKey: string): Promise<ChapterTask>;
  get(taskId: string): Promise<ChapterTask>;
  cancel(taskId: string): Promise<ChapterTask>;
  readPlan(projectKey: string): Promise<ChapterPlanReviewResult>;
  readDraft(projectKey: string): Promise<ChapterDraftReviewResult>;
}
```

`ChapterTask` is strict and contains:

```ts
{
  taskId: `chapter_${string}`;
  projectKey: string;
  kind: 'planning' | 'drafting';
  chapterNumber: number;
  status: 'queued' | 'running' | 'stop_requested'
    | 'succeeded' | 'failed' | 'cancelled';
  stage: ChapterTaskStage;
  completedStages: ChapterTaskStage[];
  sceneProgress: { current: number; total: number } | null;
  startedAt: string;
  updatedAt: string;
  canCancel: boolean;
  canRetry: boolean;
  error: { kind: ChapterErrorKind; message: string } | null;
}
```

- [ ] **Step 1: Write strict contract tests**

Assert `.strict()` rejects path/run/provider extras, byte limits reject
oversized Markdown, excessive alternatives fail, invalid scene progress fails,
alternative records expose no IDs, and a valid plan/draft review parses.

- [ ] **Step 2: Write failing service behavior tests**

Cover:

- one active task across planning and drafting per project;
- idempotent repeated start of the same kind;
- drafting refused unless plan review is complete;
- task terminal state remains sticky after delayed cancellation;
- cancellation maps engine cancellation to `cancelled`;
- login, usage limit, timeout, invalid output, missing plan, unavailable project,
  stale chapter, and unexpected errors map to author-safe kinds;
- restart-style inspection routes by artifacts rather than task ID;
- terminal retention is capped at 100.

- [ ] **Step 3: Run and verify RED**

```bash
corepack pnpm --dir apps/desktop vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts
```

Expected: FAIL because contract, gateway, and service are absent.

- [ ] **Step 4: Implement the contract and gateway**

Use exact task stages:

```ts
[
  'preparing',
  'mission',
  'plan_candidates',
  'ranking',
  'scene_cards',
  'scene_drafts',
  'draft_assembly',
  'finalizing',
  'completed'
]
```

The gateway dynamically imports only `novel-loop-engine/desktop` and translates
engine results through shared schemas.

- [ ] **Step 5: Implement the task service**

Use one `activeByProject` map shared by both task kinds. Before reporting
success, parse the corresponding plan or draft review and require
`available: true`. Use artifact inspection before every start:

```ts
if (kind === 'planning' && inspection.phase === 'plan_ready') {
  return createFailedTask(projectKey, kind, chapterNumber, 'already_complete');
}
if (kind === 'drafting' && inspection.phase !== 'plan_ready'
  && inspection.phase !== 'drafting_partial') {
  return createFailedTask(projectKey, kind, chapterNumber, 'plan_missing');
}
```

- [ ] **Step 6: Verify state protection and GREEN**

Run the focused suite and assert Story State hash equality after success,
failure, cancellation, and invalid-output recovery.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/chapterContract.ts \
  apps/desktop/src/main/chapter \
  apps/desktop/tests/main/chapterContract.test.ts \
  apps/desktop/tests/main/projectChapterService.test.ts \
  apps/desktop/tests/main/chapterStateProtection.test.ts
git commit -m "feat(desktop): add chapter task application service"
```

---

### Task 4: Expose A Narrow Trusted IPC And Preload Surface

**Files:**
- Create: `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Create: `apps/desktop/tests/main/chapterHandlers.test.ts`
- Modify: `apps/desktop/tests/preload/preloadBoundary.test.ts`
- Modify: `apps/desktop/tests/main/sessionPermissionPolicy.test.ts`

**Interfaces:**
- Consumes `ChapterApplicationService` from Task 3.
- Adds fixed channels:

```ts
chapterInspect: 'novel-loop:chapter:inspect'
chapterStartPlanning: 'novel-loop:chapter:start-planning'
chapterStartDrafting: 'novel-loop:chapter:start-drafting'
chapterGet: 'novel-loop:chapter:get'
chapterCancel: 'novel-loop:chapter:cancel'
chapterReadPlan: 'novel-loop:chapter:read-plan'
chapterReadDraft: 'novel-loop:chapter:read-draft'
```

- [ ] **Step 1: Write failing handler and preload tests**

Assert:

- untrusted sender is rejected before parsing or service invocation;
- unknown keys, raw paths, provider, chapter number, prompt, command, and commit
  fields are rejected;
- every response is schema-parsed;
- preload exposes exactly the seven chapter methods and no generic `invoke`,
  filesystem, shell, process, or Codex method.

- [ ] **Step 2: Run and verify RED**

```bash
corepack pnpm --dir apps/desktop vitest run \
  tests/main/chapterHandlers.test.ts \
  tests/preload/preloadBoundary.test.ts \
  tests/main/sessionPermissionPolicy.test.ts
```

- [ ] **Step 3: Implement handlers and desktop API**

Each handler follows this order:

```ts
assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
const parsedRequest = ChapterStartRequestSchema.parse(request);
return ChapterTaskSchema.parse(
  await service.startPlanning(parsedRequest.projectKey)
);
```

Do not add dynamic operation names.

- [ ] **Step 4: Register the service in Electron main**

Create one `ProjectChapterService` with the existing `ProjectLibraryService` as
its opaque project-root resolver and register handlers before creating the
window.

- [ ] **Step 5: Verify GREEN and commit**

```bash
corepack pnpm --dir apps/desktop vitest run \
  tests/main/chapterHandlers.test.ts \
  tests/preload/preloadBoundary.test.ts \
  tests/main/sessionPermissionPolicy.test.ts \
  tests/main/planningHandlers.test.ts
git add apps/desktop/src/main/ipc/registerChapterHandlers.ts \
  apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts \
  apps/desktop/src/shared/desktopApi.ts \
  apps/desktop/src/shared/ipcChannels.ts \
  apps/desktop/tests/main/chapterHandlers.test.ts \
  apps/desktop/tests/preload/preloadBoundary.test.ts \
  apps/desktop/tests/main/sessionPermissionPolicy.test.ts
git commit -m "feat(desktop): expose trusted chapter workflow IPC"
```

---

### Task 5: Build The Author-Facing Planning And Draft Workspace

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/features/planning/PlanningReview.tsx`
- Modify: `apps/desktop/src/renderer/src/features/projects/ProjectOverview.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterPlanningGenerationView.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterDraftGenerationView.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx`
- Create: `apps/desktop/src/renderer/src/styles/chapter.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Modify: `apps/desktop/tests/renderer/App.test.tsx`
- Modify: `apps/desktop/tests/renderer/planningReview.test.tsx`
- Create: `apps/desktop/tests/renderer/chapterPlanningGeneration.test.tsx`
- Create: `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`
- Create: `apps/desktop/tests/renderer/chapterDraftGeneration.test.tsx`
- Create: `apps/desktop/tests/renderer/chapterWorkspace.test.tsx`

**Interfaces:**
- Consumes the typed preload API from Task 4.
- Adds routes:

```ts
| { kind: 'chapter-planning-generation'; project: ProjectSummary }
| { kind: 'chapter-plan-review'; project: ProjectSummary }
| { kind: 'chapter-draft-generation'; project: ProjectSummary }
| { kind: 'chapter-workspace'; project: ProjectSummary };
```

- [ ] **Step 1: Write failing route and planning-generation tests**

Assert:

- global planning review button says `创建第 1 章` when no chapter is committed;
- Project Overview resumes the correct chapter phase from `chapter.inspect`;
- starting planning requires explicit inline confirmation;
- progress is polled with stable terminal state;
- safe stop and retry use natural language;
- leaving and returning recovers from artifact inspection.

- [ ] **Step 2: Run the focused renderer tests and verify RED**

```bash
corepack pnpm --dir apps/desktop vitest run \
  tests/renderer/App.test.tsx \
  tests/renderer/planningReview.test.tsx \
  tests/renderer/chapterPlanningGeneration.test.tsx
```

- [ ] **Step 3: Implement routing and planning generation**

Reuse the proven task polling rules:

- poll every 250 ms in tests through fake timers;
- ignore stale request tokens after unmount;
- terminal success/failure/cancel remains sticky;
- transient `get` failure does not erase visible progress;
- completion refreshes inspection before changing route.

- [ ] **Step 4: Write failing plan-review and draft-confirmation tests**

Assert every author-facing mission section renders, selected plan is text-safe,
alternatives are collapsed, internal metadata is absent, keyboard navigation
works, and drafting API is not called before the second confirmation.

- [ ] **Step 5: Implement plan review**

Use semantic headings and lists. Render Markdown as text blocks without
`dangerouslySetInnerHTML`. The primary action sequence is:

```text
确认方向并生成草稿
-> inline confirmation explains initial-draft and Story State boundary
-> 开始生成草稿
```

- [ ] **Step 6: Write failing drafting and workspace tests**

Assert scene progress `X / Y`, safe stop/retry, draft status `初稿`, word count,
scene summaries, three-column responsive structure, and absence of editing,
diagnostics, final, and commit controls.

- [ ] **Step 7: Implement drafting and Chapter Workspace**

Use stable responsive tracks:

```css
.nl-chapter-workspace {
  display: grid;
  grid-template-columns: minmax(12rem, 15rem) minmax(30rem, 1fr)
    minmax(16rem, 20rem);
}
```

At narrower widths, collapse the left and right context into full-width bands
without overlapping the manuscript. Keep card radius at 8 px or less, use
Phosphor icons, existing neutral/green tokens, zero negative letter spacing,
and no decorative gradients or nested cards.

- [ ] **Step 8: Verify renderer GREEN and commit**

```bash
corepack pnpm --dir apps/desktop vitest run tests/renderer
git add apps/desktop/src/renderer/src \
  apps/desktop/tests/renderer
git commit -m "feat(desktop): add chapter planning and draft workspace"
```

---

### Task 6: Verify Production Electron Flow And Document The Milestone

**Files:**
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`
- Modify: `README.md`
- Modify: `docs/product/novel-loop-prototype-test-script.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces production Electron proof for:

```text
global plan review
-> chapter planning confirmation
-> fake Codex mission/candidates/ranking
-> plan review
-> drafting confirmation
-> fake Codex scene cards/scenes
-> draft workspace
```

- [ ] **Step 1: Extend fake Codex with an exact chapter allowlist**

Allow only the expected chapter prompt fixtures and output schemas. Reject:

- unknown prompt text;
- unknown output schema;
- provider/shell/workspace-write flags;
- commit, final, patch, stale regeneration, or recommit operations.

- [ ] **Step 2: Write the failing production Electron test**

Create a temporary project with complete Foundation and global planning, launch
the packaged Electron output, execute the two confirmations, and assert:

```ts
expect(await page.getByText('初稿').isVisible()).toBe(true);
expect(await sha256(paths.storyState())).toBe(beforeStateHash);
expect(await fileStore.exists(paths.chapterArtifact(1, 'draft_v1.md')))
  .toBe(true);
expect(await fileStore.exists(paths.chapterArtifact(1, 'final.md')))
  .toBe(false);
expect(await fileStore.exists(paths.chapterArtifact(1, 'canon_patch.json')))
  .toBe(false);
```

- [ ] **Step 3: Run the Electron test and verify RED**

```bash
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e:required
```

Expected: FAIL until the fake boundary and full route are complete.

- [ ] **Step 4: Complete fake fixtures and documentation**

Document:

- launch command;
- chapter workflow stopping at initial draft;
- real local Codex requirement;
- Story State remains unchanged;
- diagnostics, editing, final, and commit remain unavailable in this milestone.

- [ ] **Step 5: Run complete verification**

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e:required
git diff --check
corepack pnpm novel-loop codex status
```

Expected:

- root build and all root tests pass;
- desktop typecheck, all desktop tests, and production build pass;
- all required Electron E2E tests pass;
- Codex status reports provider availability or only the existing non-blocking
  doctor warning;
- no tracked generated project, raw Codex, auth, or secret files.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/tests/e2e/electron-smoke.test.ts README.md \
  docs/product/novel-loop-prototype-test-script.md
git commit -m "test(desktop): verify chapter planning and draft flow"
```
