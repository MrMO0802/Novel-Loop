# Novel Loop Desktop Global Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author generate and review global planning from the secure Electron desktop application after completing Story Foundation.

**Architecture:** Extend `planGlobal` with the same progress, cooperative-stop, resume, and project-lock lifecycle already used by `buildBible`. Add a desktop-only engine wrapper and a dedicated typed Electron planning boundary; render author-facing generation and review views without exposing filesystem paths, run IDs, raw JSON, or Codex internals.

**Tech Stack:** Node.js 20+, TypeScript, Zod, Electron, React 19, electron-vite, Vitest, Testing Library, Playwright.

## Global Constraints

- Provider is fixed to the existing local `codex-text` boundary.
- Renderer remains sandboxed and cannot access Node.js, the filesystem, shell, or Codex.
- Planning generation must not modify `state/story_state.json`.
- `arc_map.json` and `chapter_queue.json` must pass existing Zod schemas before write.
- Existing valid planning artifacts must not be overwritten during incomplete-task resume.
- No chapter generation, DeepSeek, OpenAI API, web UI, or workspace-write access.
- All author-facing copy is Chinese and all IPC payloads are strict Zod contracts.

---

### Task 1: Engine Planning Lifecycle and Desktop Wrapper

**Files:**
- Modify: `src/app/planGlobal.ts`
- Create: `src/desktop/globalPlanning.ts`
- Modify: `src/desktop/index.ts`
- Create: `tests/integration/planGlobalLifecycle.test.ts`
- Create: `tests/unit/desktopGlobalPlanning.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanGlobalStage =
  | 'preparing'
  | 'global_outline'
  | 'volume_outline'
  | 'arc_map'
  | 'chapter_queue'
  | 'finalizing'
  | 'completed';

export interface PlanGlobalProgressEvent {
  stage: PlanGlobalStage;
  state: 'started' | 'completed';
}

export interface DesktopGlobalPlanningInput {
  projectRoot: string;
  onProgress?: (event: PlanGlobalProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export async function planDesktopGlobal(
  input: DesktopGlobalPlanningInput
): Promise<{ artifactCount: 4; completed: true }>;

export async function readDesktopGlobalPlanning(
  input: { projectRoot: string }
): Promise<DesktopGlobalPlanningReview>;
```

- Consumes: existing `planGlobal`, `ProjectPaths`, `FileStore`,
  `ArcMapSchema`, `ChapterQueueSchema`, and `acquireProjectBuildLock`.

- [ ] **Step 1: Write failing engine lifecycle tests**

Add tests that assert:

```ts
expect(progress).toEqual([
  'preparing:started',
  'preparing:completed',
  'global_outline:started',
  'global_outline:completed',
  'volume_outline:started',
  'volume_outline:completed',
  'arc_map:started',
  'arc_map:completed',
  'chapter_queue:started',
  'chapter_queue:completed',
  'finalizing:started',
  'finalizing:completed',
  'completed:completed'
]);
```

Also assert cancellation before a later stage throws
`PLAN_GLOBAL_CANCELLED`, incomplete resume reuses valid existing artifacts,
all-complete rerun throws `ARTIFACT_ALREADY_EXISTS`, concurrent build lock
throws a busy error, invalid resumed JSON is rejected, and Story State bytes
remain unchanged.

- [ ] **Step 2: Run the lifecycle tests and verify RED**

Run:

```bash
corepack pnpm vitest run tests/integration/planGlobalLifecycle.test.ts
```

Expected: FAIL because `PlanGlobalInput` has no lifecycle controls and
`planGlobal` does not preserve completed stages.

- [ ] **Step 3: Implement lifecycle behavior**

Refactor the four Codex stages into stage helpers that:

```ts
await reportProgress(input, { stage, state: 'started' });
if (input.resumeIncomplete === true && await fileStore.exists(outputPath)) {
  const reused = await readAndValidateExistingStage(...);
  await runLogger.recordArtifact(runId, relativePath, {
    action: 'reused',
    stage: 'planning',
    provenanceNote: 'resumed desktop global planning stage'
  });
  await reportProgress(input, { stage, state: 'completed' });
  return reused;
}
await stopBeforeNextCall(input);
const generated = await generateStage(...);
await reportProgress(input, { stage, state: 'completed' });
return generated;
```

Acquire and release the project build lock in `try/finally`, bound Markdown
outputs to 2 MiB each, classify cancellation as recoverable, and retain the
existing CLI result shape.

- [ ] **Step 4: Run engine tests and verify GREEN**

Run:

```bash
corepack pnpm vitest run tests/integration/planGlobalLifecycle.test.ts tests/integration/buildBiblePlanGlobal.test.ts tests/e2e/codexTaskSplitter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing desktop wrapper tests**

Test that `planDesktopGlobal` fixes provider to `codex-text`, returns exactly
four completed artifacts, and `readDesktopGlobalPlanning`:

- returns `available: false` when incomplete;
- returns two Markdown documents plus filtered arc/chapter records;
- rejects non-files, oversized Markdown, and schema-invalid JSON;
- excludes `artifactPath`, `latestRunId`, paths, and run IDs.

- [ ] **Step 6: Run wrapper tests and verify RED**

Run:

```bash
corepack pnpm vitest run tests/unit/desktopGlobalPlanning.test.ts
```

Expected: FAIL because `src/desktop/globalPlanning.ts` does not exist.

- [ ] **Step 7: Implement the desktop wrapper and exports**

Use strict local Zod schemas for the wrapper result. Read Markdown with a 2 MiB
per-document and 4 MiB total bound. Read JSON using `FileStore.readJson` with
`ArcMapSchema` and `ChapterQueueSchema`, then map only:

```ts
{
  arcs: arcMap.arcs.map(({ id, name, type, summary, startChapter,
    targetEndChapter, relatedCharacters }) => ({ id, name, type, summary,
    startChapter, targetEndChapter, relatedCharacters })),
  chapters: chapterQueue.chapters.map(({ chapterNumber, title, status, summary,
    primaryFunction }) => ({ chapterNumber, title, status, summary,
    primaryFunction }))
}
```

- [ ] **Step 8: Verify root build and tests**

Run:

```bash
corepack pnpm build
corepack pnpm vitest run tests/integration/planGlobalLifecycle.test.ts tests/unit/desktopGlobalPlanning.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/planGlobal.ts src/desktop/globalPlanning.ts src/desktop/index.ts tests/integration/planGlobalLifecycle.test.ts tests/unit/desktopGlobalPlanning.test.ts
git commit -m "feat(engine): expose desktop global planning lifecycle"
```

---

### Task 2: Typed Planning Contract and Main-Process Task Service

**Files:**
- Create: `apps/desktop/src/shared/planningContract.ts`
- Create: `apps/desktop/src/main/planning/EnginePlanningGateway.ts`
- Create: `apps/desktop/src/main/planning/ProjectPlanningService.ts`
- Create: `apps/desktop/tests/main/planningContract.test.ts`
- Create: `apps/desktop/tests/main/projectPlanningService.test.ts`
- Create: `apps/desktop/tests/main/planningStateProtection.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PlanningApplicationService {
  start(projectKey: string): Promise<PlanningTask>;
  get(taskId: string): Promise<PlanningTask>;
  cancel(taskId: string): Promise<PlanningTask>;
  read(projectKey: string): Promise<PlanningReviewResult>;
}
```

- `PlanningTask` contains only opaque task/project keys, status, current stage,
  completed stages, timestamps, cancellation/retry flags, and a bounded
  author-facing error.

- [ ] **Step 1: Write failing contract tests**

Assert strict parsing, task ID format `planning_<hex>`, seven lifecycle stages,
all error categories, duplicate arc/chapter rejection, payload byte bounds, and
rejection of unknown fields such as `projectRoot`, `runId`, and `artifactPath`.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/planningContract.test.ts
```

Expected: FAIL because the contract does not exist.

- [ ] **Step 3: Implement the strict shared contract**

Define Zod schemas for start/get/cancel/read requests, task state, two Markdown
documents, filtered arcs, filtered chapters, and the discriminated review
result. Keep each error message at most 320 characters.

- [ ] **Step 4: Run contract tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing service tests**

Cover one active task per project, concurrent start deduplication, progress
updates, stop request idempotency, success, cancellation, retryability,
already-complete detection, project-unavailable behavior, bounded terminal-task
retention, and provider error classification.

- [ ] **Step 6: Run service tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/projectPlanningService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 7: Implement gateway and service**

Mirror the proven Foundation service while keeping planning types separate.
`EnginePlanningGateway` lazily imports `novel-loop-engine/desktop`, and
`ProjectPlanningService` runs the gateway asynchronously after returning the
initial queued task.

- [ ] **Step 8: Add and pass Story State protection test**

Create a real temporary project, generate Story Foundation with fixtures, invoke
the planning gateway with fake Codex, and assert the SHA-256 of
`state/story_state.json` is unchanged before and after success and failure.

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/projectPlanningService.test.ts tests/main/planningStateProtection.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/shared/planningContract.ts apps/desktop/src/main/planning apps/desktop/tests/main/planningContract.test.ts apps/desktop/tests/main/projectPlanningService.test.ts apps/desktop/tests/main/planningStateProtection.test.ts
git commit -m "feat(desktop): add global planning task service"
```

---

### Task 3: Trusted IPC, Preload, and Main Wiring

**Files:**
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Create: `apps/desktop/src/main/ipc/registerPlanningHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/tests/main/planningHandlers.test.ts`
- Modify: `apps/desktop/tests/preload/preloadBoundary.test.ts`

**Interfaces:**
- Adds fixed channels:

```ts
planningStart: 'novel-loop:planning:start'
planningGet: 'novel-loop:planning:get'
planningCancel: 'novel-loop:planning:cancel'
planningRead: 'novel-loop:planning:read'
```

- Adds `window.novelLoop.planning.start/get/cancel/read`.

- [ ] **Step 1: Write failing handler and preload tests**

Assert trusted sender enforcement, request parsing before service calls,
response parsing before return, exact fixed channels, and absence of generic
`invoke`, filesystem, shell, Codex, or path APIs.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/planningHandlers.test.ts tests/preload/preloadBoundary.test.ts
```

Expected: FAIL because planning channels are absent.

- [ ] **Step 3: Implement handlers and preload API**

Follow `registerFoundationHandlers` exactly for sender trust and strict parsing.
Instantiate `ProjectPlanningService` in Electron main with the existing project
root resolver and register all four handlers before window creation.

- [ ] **Step 4: Verify tests and desktop typecheck**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/planningHandlers.test.ts tests/preload/preloadBoundary.test.ts
corepack pnpm --dir apps/desktop check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared apps/desktop/src/main/index.ts apps/desktop/src/main/ipc/registerPlanningHandlers.ts apps/desktop/src/preload/index.ts apps/desktop/tests/main/planningHandlers.test.ts apps/desktop/tests/preload/preloadBoundary.test.ts
git commit -m "feat(desktop): expose trusted global planning IPC"
```

---

### Task 4: Author-Facing Generation and Review

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/features/projects/ProjectOverview.tsx`
- Modify: `apps/desktop/src/renderer/src/features/foundation/FoundationReview.tsx`
- Create: `apps/desktop/src/renderer/src/features/planning/PlanningGenerationView.tsx`
- Create: `apps/desktop/src/renderer/src/features/planning/PlanningReview.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Create: `apps/desktop/src/renderer/src/styles/planning.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/tests/renderer/App.test.tsx`
- Create: `apps/desktop/tests/renderer/planningGeneration.test.tsx`
- Create: `apps/desktop/tests/renderer/planningReview.test.tsx`

**Interfaces:**
- `FoundationReview` adds `onPreparePlanning`.
- `ProjectOverview` adds `onPreparePlanning` and `onReviewPlanning`.
- `AppRoute` adds `planning-generation` and `planning-review`.

- [ ] **Step 1: Write failing routing and confirmation tests**

Assert:

- incomplete Foundation still routes to Story Foundation;
- complete Foundation plus incomplete planning routes to preparation;
- complete planning routes to review;
- Foundation review shows `确认故事基础并生成全局规划`;
- clicking it does not call planning until the explicit generation screen
  confirmation is pressed.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/renderer/App.test.tsx tests/renderer/foundationReview.test.tsx
```

Expected: FAIL because planning routes/actions are absent.

- [ ] **Step 3: Implement routing and Project Overview state**

Use the table in the design spec for the single primary next action. Keep the
Story Foundation review reachable through its existing screen and refresh the
project summary through `projects.open` after planning succeeds.

- [ ] **Step 4: Write failing generation tests**

Cover explicit confirmation, stage polling, stop request, retry after a partial
failure, stale refresh recovery, inaccessible task recovery, natural-language
errors, and no technical metadata in rendered text.

- [ ] **Step 5: Run generation tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/renderer/planningGeneration.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement generation view**

Use stable stage rows with:

```ts
const STAGE_LABELS = {
  preparing: '正在读取故事基础',
  global_outline: '正在规划全书方向',
  volume_outline: '正在组织第一卷',
  arc_map: '正在梳理故事线',
  chapter_queue: '正在安排章节计划',
  finalizing: '正在检查规划结果',
  completed: '全局规划已准备完成'
} satisfies Record<PlanningStage, string>;
```

Polling interval remains 750 ms. Stop only requests cooperative cancellation;
copy explains that the current Codex step may finish first.

- [ ] **Step 7: Write failing planning review tests**

Assert four accessible tabs, Markdown rendering, semantic arc and chapter
lists, keyboard tab navigation, no raw JSON/paths/run IDs, no Story State
mutation claim, and the visibly unavailable next-chapter notice.

- [ ] **Step 8: Run review tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/renderer/planningReview.test.tsx
```

Expected: FAIL because the review component does not exist.

- [ ] **Step 9: Implement review and restrained responsive styles**

Reuse existing design tokens and card radius rules. Use tabs for view selection,
unframed readable Markdown, compact arc entries, and a stable chapter table/list.
Use Phosphor icons already installed. Do not add marketing copy, nested cards,
gradients, or developer-facing metadata.

- [ ] **Step 10: Verify renderer and accessibility tests**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/renderer
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop build
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/tests/renderer
git commit -m "feat(desktop): add global planning author workflow"
```

---

### Task 5: Production Electron Flow and Full Regression

**Files:**
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`
- Modify: `README.md`

**Interfaces:**
- No new runtime interface.
- Acceptance flow: project overview → Story Foundation review → planning
  confirmation → planning progress → planning review.

- [ ] **Step 1: Add failing production Electron smoke**

Use a temporary project with complete Story Foundation and a fake Codex binary.
Verify a packaged renderer can:

- open the project;
- start planning;
- observe progress;
- review all four planning sections;
- return to overview with `全局规划 已准备`;
- leave Story State hash unchanged.

- [ ] **Step 2: Run the smoke and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test:e2e
```

Expected: FAIL until the complete flow is wired.

- [ ] **Step 3: Complete integration fixes and document the milestone**

Update README desktop status to state that Story Foundation and global planning
are connected, while chapter creation remains the next milestone. Document the
secure local Codex boundary and the no-Story-State-mutation guarantee.

- [ ] **Step 4: Run focused verification**

```bash
corepack pnpm build
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e
```

Expected: PASS.

- [ ] **Step 5: Run full regression**

```bash
corepack pnpm test
git diff --check
git status --short
```

Expected: root and desktop suites pass, no whitespace errors, and only intended
feature files are modified.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/tests/e2e/electron-smoke.test.ts README.md
git commit -m "test(desktop): verify global planning author flow"
```
