# Novel Loop Desktop Story Bible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author generate and review the four Story Foundation documents from the secure Electron desktop application without exposing paths, Codex internals, or Story State mutation.

**Architecture:** The engine gains a desktop-safe Story Bible wrapper plus stage callbacks and cooperative stop checks. Electron main owns an in-memory background task service behind fixed, schema-validated IPC channels; the sandboxed renderer polls opaque task state and renders confirmation, progress, recovery, and read-only review screens.

**Tech Stack:** Node.js 20+, TypeScript, Zod, Electron, React 19, electron-vite, Vitest, Testing Library, Playwright.

## Global Constraints

- Provider is fixed to the existing local `codex-text` provider.
- Renderer cannot receive project paths, run IDs, raw Codex output, JSONL, auth data, or generic IPC access.
- Renderer cannot execute Codex, shell commands, or filesystem operations.
- Story State and chapter queue must remain unchanged.
- Existing complete Story Foundation artifacts cannot be overwritten.
- Cancellation is cooperative and takes effect before the next Codex prompt.
- Partial failure remains recoverable through a new provenance run.
- Tests cannot require real Codex or an API key.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, navigation denial, popup denial, and permission denial unchanged.

---

### Task 1: Engine Progress, Cancellation, And Packaged Assets

**Files:**
- Modify: `src/app/buildBible.ts`
- Modify: `src/providers/codex/schemas.ts`
- Create: `src/desktop/storyBible.ts`
- Modify: `src/desktop/index.ts`
- Modify: `src/desktop/projectLibrary.ts`
- Create: `tests/integration/buildBibleLifecycle.test.ts`
- Create: `tests/unit/desktopStoryBible.test.ts`
- Modify: `tests/unit/desktopProjectLibrary.test.ts`

**Interfaces:**
- Produces: `BuildBibleStage`, `BuildBibleProgressEvent`, `BuildBibleInput.onProgress`, `BuildBibleInput.shouldStop`, and `BuildBibleInput.resumeIncomplete`.
- Produces: `buildDesktopStoryBible(input): Promise<DesktopStoryBibleResult>`.
- Produces: `readDesktopStoryBible(input): Promise<DesktopStoryBibleReview>`.
- Guarantees: a complete four-file strategy set is never overwritten by `resumeIncomplete`.
- Guarantees: cancellation is checked between prompts and closes the run as `cancelled`.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests with a deterministic mock provider fixture and a temporary project:

```ts
test('reports ordered stages and leaves Story State unchanged', async () => {
  const before = await fileStore.readText(paths.storyState());
  const events: BuildBibleProgressEvent[] = [];

  await buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    onProgress: (event) => {
      events.push(event);
    }
  });

  expect(events).toEqual(expect.arrayContaining([
    { stage: 'preparing', state: 'started' },
    { stage: 'story_bible', state: 'started' },
    { stage: 'story_bible', state: 'completed' },
    { stage: 'genre_contract', state: 'started' },
    { stage: 'reader_promise', state: 'started' },
    { stage: 'style_guide', state: 'started' },
    { stage: 'finalizing', state: 'completed' },
    { stage: 'completed', state: 'completed' }
  ]));
  expect(await fileStore.readText(paths.storyState())).toBe(before);
});

test('stops before the next prompt and records a cancelled run', async () => {
  let stopRequested = false;

  await expect(buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    shouldStop: () => stopRequested,
    onProgress: (event) => {
      if (event.stage === 'story_bible' && event.state === 'completed') {
        stopRequested = true;
      }
    }
  })).rejects.toMatchObject({ code: 'BUILD_BIBLE_CANCELLED' });

  expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md'))).toBe(true);
  expect(await fileStore.exists(path.join(paths.strategyDir(), 'genre_contract.md'))).toBe(false);
  expect((await readLatestRunManifest(paths)).status).toBe('blocked');
});

test('resumeIncomplete can replace a partial set but not a complete set', async () => {
  await fileStore.writeText(path.join(paths.strategyDir(), 'story_bible.md'), 'partial');
  await expect(buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    resumeIncomplete: true
  })).resolves.toBeDefined();

  await expect(buildBible({
    projectId,
    projectsRoot,
    provider: 'mock',
    resumeIncomplete: true
  })).rejects.toMatchObject({ code: 'ARTIFACT_ALREADY_EXISTS' });
});
```

- [ ] **Step 2: Run the lifecycle tests and verify RED**

Run:

```bash
corepack pnpm vitest run tests/integration/buildBibleLifecycle.test.ts
```

Expected: FAIL because lifecycle hooks and `resumeIncomplete` do not exist.

- [ ] **Step 3: Add lifecycle types and minimal build loop hooks**

Add:

```ts
export type BuildBibleStage =
  | 'preparing'
  | 'story_bible'
  | 'genre_contract'
  | 'reader_promise'
  | 'style_guide'
  | 'finalizing'
  | 'completed';

export interface BuildBibleProgressEvent {
  stage: BuildBibleStage;
  state: 'started' | 'completed';
}

export interface BuildBibleInput {
  // existing fields stay unchanged
  onProgress?: (event: BuildBibleProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}
```

Map prompt IDs to author stages, call `onProgress` immediately before and after
each prompt, and check `shouldStop` before each new prompt. Throw:

```ts
new AppError(
  'BUILD_BIBLE_CANCELLED',
  'Story Bible generation stopped before the next stage.',
  2
)
```

In the catch block, record a recoverable cancellation error and end the run
with `cancelled`; retain the existing failed behavior for all other errors.

Change output protection so:

```ts
if (existingCount === BUILD_BIBLE_PROMPTS.length) {
  throw artifactAlreadyExists;
}
if (existingCount > 0 && input.resumeIncomplete !== true && !force) {
  throw artifactAlreadyExists;
}
```

- [ ] **Step 4: Resolve prompt, fixture, and schema assets from package location**

Replace working-directory defaults with module-relative package assets:

```ts
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_PROMPT_ROOT = path.join(PACKAGE_ROOT, 'prompts');
const DEFAULT_FIXTURES_ROOT = path.join(PACKAGE_ROOT, 'fixtures', 'llm');
```

In `src/providers/codex/schemas.ts`:

```ts
const SCHEMA_ROOT = fileURLToPath(
  new URL('../../../schemas/codex-output/', import.meta.url)
);
```

Add a test that changes `process.cwd()` to a temporary directory and confirms
the desktop wrapper still finds prompts and registered output schemas.

- [ ] **Step 5: Add the desktop engine wrapper**

Implement:

```ts
export interface DesktopStoryBibleInput {
  projectRoot: string;
  onProgress?: (event: BuildBibleProgressEvent) => void | Promise<void>;
  shouldStop?: () => boolean | Promise<boolean>;
  resumeIncomplete?: boolean;
}

export interface DesktopStoryBibleResult {
  artifactCount: 4;
  completed: true;
}

export async function buildDesktopStoryBible(
  input: DesktopStoryBibleInput
): Promise<DesktopStoryBibleResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectId = ProjectIdSchema.parse(path.basename(projectRoot));
  const result = await buildBible({
    projectId,
    projectsRoot: path.dirname(projectRoot),
    provider: 'codex-text',
    onProgress: input.onProgress,
    shouldStop: input.shouldStop,
    resumeIncomplete: input.resumeIncomplete
  });
  const completedArtifactCount = result.artifacts
    .filter((artifact) => FOUNDATION_ARTIFACTS.includes(artifact))
    .length;
  if (completedArtifactCount !== 4) {
    throw new AppError(
      'DESKTOP_STORY_BIBLE_INCOMPLETE',
      'Story Foundation generation did not produce all required documents.',
      2
    );
  }
  return DesktopStoryBibleResultSchema.parse({
    artifactCount: 4,
    completed: true
  });
}
```

Add `readDesktopStoryBible({ projectRoot })`, which reads exactly the four
fixed strategy artifacts and returns four `{ kind, title, markdown }`
documents. It must return `{ available: false }` unless all four files exist.
Parse returns through internal Zod schemas and export only the functions and
safe types from `src/desktop/index.ts`.

Update `inspectDesktopProject` so `storyBibleAvailable` is true only when all
four files exist. Add a regression test where `story_bible.md` exists alone
and availability remains false.

- [ ] **Step 6: Run focused and root tests**

Run:

```bash
corepack pnpm vitest run tests/integration/buildBibleLifecycle.test.ts tests/unit/desktopStoryBible.test.ts tests/unit/desktopProjectLibrary.test.ts
corepack pnpm build
```

Expected: all focused tests pass and TypeScript builds.

- [ ] **Step 7: Commit**

```bash
git add src/app/buildBible.ts src/providers/codex/schemas.ts src/desktop/storyBible.ts src/desktop/index.ts src/desktop/projectLibrary.ts tests/integration/buildBibleLifecycle.test.ts tests/unit/desktopStoryBible.test.ts tests/unit/desktopProjectLibrary.test.ts
git commit -m "feat(engine): expose desktop Story Bible lifecycle"
```

---

### Task 2: Typed Foundation Contract

**Files:**
- Create: `apps/desktop/src/shared/foundationContract.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Create: `apps/desktop/tests/main/foundationContract.test.ts`
- Modify: `apps/desktop/tests/preload/preloadBoundary.test.ts`

**Interfaces:**
- Produces: strict schemas and inferred types for task start, polling,
  cancellation, and review.
- Produces: fixed IPC channels `foundationStart`, `foundationGet`,
  `foundationCancel`, and `foundationRead`.
- Produces: `NovelLoopDesktopApi.foundation`.

- [ ] **Step 1: Write failing contract tests**

Cover normalization, strict rejection, bounded markdown, and absence of paths:

```ts
test('accepts an author-safe running task', () => {
  expect(FoundationTaskSchema.parse({
    taskId: 'foundation_0123456789abcdef',
    projectKey: 'project_0123456789abcdef01234567',
    status: 'running',
    stage: 'story_bible',
    completedStages: ['preparing'],
    startedAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T01:00:01.000Z',
    canCancel: true,
    canRetry: false,
    error: null
  })).toMatchObject({ status: 'running' });
});

test('rejects filesystem and provider details', () => {
  expect(() => FoundationTaskSchema.parse({
    ...runningTask,
    projectRoot: '/private/project',
    runId: 'run_secret',
    codexBin: '/usr/bin/codex'
  })).toThrow();
});
```

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/foundationContract.test.ts tests/preload/preloadBoundary.test.ts
```

Expected: FAIL because the foundation contract and API do not exist.

- [ ] **Step 3: Implement strict Zod contracts**

Create schemas:

```ts
export const FoundationTaskStatusSchema = z.enum([
  'queued',
  'running',
  'stop_requested',
  'succeeded',
  'failed',
  'cancelled'
]);

export const FoundationStageSchema = z.enum([
  'preparing',
  'story_bible',
  'genre_contract',
  'reader_promise',
  'style_guide',
  'finalizing',
  'completed'
]);

export const FoundationErrorKindSchema = z.enum([
  'codex_unavailable',
  'login_required',
  'usage_limit',
  'timeout',
  'invalid_output',
  'project_unavailable',
  'already_complete',
  'unexpected'
]);
```

`FoundationTaskSchema` must be `.strict()` and contain only the fields shown in
the tests. Define strict request schemas:

```ts
FoundationStartRequestSchema = z.object({ projectKey: ProjectKeySchema }).strict();
FoundationGetRequestSchema = z.object({ taskId: FoundationTaskIdSchema }).strict();
FoundationCancelRequestSchema = FoundationGetRequestSchema;
FoundationReadRequestSchema = FoundationStartRequestSchema;
```

Define `FoundationReviewResultSchema` as a discriminated union:

```ts
z.discriminatedUnion('available', [
  z.object({ available: z.literal(false), reason: z.enum([
    'not_ready',
    'project_unavailable'
  ]) }).strict(),
  z.object({
    available: z.literal(true),
    documents: z.array(FoundationDocumentSchema).length(4)
  }).strict()
]);
```

Each document has `kind`, localized `title`, and markdown bounded to 2 MiB.

- [ ] **Step 4: Extend API and fixed channels**

Add:

```ts
foundation: {
  start(request: FoundationStartRequest): Promise<FoundationTask>;
  get(request: FoundationGetRequest): Promise<FoundationTask>;
  cancel(request: FoundationCancelRequest): Promise<FoundationTask>;
  read(request: FoundationReadRequest): Promise<FoundationReviewResult>;
};
```

Use literal channel names only. Update preload boundary assertions to reject
dynamic channel invocation and forbidden fields.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/foundationContract.test.ts tests/preload/preloadBoundary.test.ts
corepack pnpm --dir apps/desktop check
```

Commit:

```bash
git add apps/desktop/src/shared apps/desktop/tests/main/foundationContract.test.ts apps/desktop/tests/preload/preloadBoundary.test.ts
git commit -m "feat(desktop): define Story Foundation contract"
```

---

### Task 3: Main-process Foundation Task Service

**Files:**
- Create: `apps/desktop/src/main/foundation/EngineFoundationGateway.ts`
- Create: `apps/desktop/src/main/foundation/ProjectFoundationService.ts`
- Modify: `apps/desktop/src/main/projects/ProjectLibraryService.ts`
- Create: `apps/desktop/tests/main/projectFoundationService.test.ts`
- Modify: `apps/desktop/tests/main/projectLibraryService.test.ts`

**Interfaces:**
- Consumes: `buildDesktopStoryBible` and `BuildBibleProgressEvent`.
- Produces: `ProjectFoundationApplicationService`.
- Produces: internal `ProjectLibraryService.resolveProjectRoot`.
- Guarantees: one active task per project, task/project isolation, cooperative
  cancellation, four-file review completeness, and no complete overwrite.

- [ ] **Step 1: Write failing task service tests**

Use a deferred fake gateway:

```ts
test('starts one background task and reports ordered progress', async () => {
  const gateway = new DeferredFoundationGateway();
  const service = createService({ gateway });

  const started = await service.start(projectKey);
  expect(started.status).toBe('queued');

  gateway.emit({ stage: 'story_bible', state: 'started' });
  await eventually(async () => {
    expect((await service.get(started.taskId)).stage).toBe('story_bible');
  });

  const duplicate = await service.start(projectKey);
  expect(duplicate.taskId).toBe(started.taskId);
});

test('marks stop_requested and stops before the next stage', async () => {
  const task = await service.start(projectKey);
  expect((await service.cancel(task.taskId)).status).toBe('stop_requested');
  gateway.completeWithCancellation();
  await eventually(async () => {
    expect((await service.get(task.taskId)).status).toBe('cancelled');
  });
});

test('never starts when all four documents already exist', async () => {
  gateway.reviewResult = completeReview;
  const task = await service.start(projectKey);
  expect(task.status).toBe('failed');
  expect(task.error?.kind).toBe('already_complete');
  expect(gateway.build).not.toHaveBeenCalled();
});
```

Also verify unknown `taskId`, missing project, partial retry with
`resumeIncomplete: true`, stable state hash, and bounded task retention.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/projectFoundationService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Add an internal project-root resolver**

Add a public method to the concrete `ProjectLibraryService` class without
adding it to the renderer-facing `ProjectLibraryApplicationService` interface:

```ts
resolveProjectRoot(projectKey: string): Promise<string | null>;
```

Implement it by loading the registry, finding the opaque key, resolving the
canonical directory, and returning `null` for missing, unreadable, or invalid
projects. `ProjectFoundationService` consumes a narrow internal structural port:

```ts
export interface ProjectRootResolver {
  resolveProjectRoot(projectKey: string): Promise<string | null>;
}
```

Do not expose this method in preload or IPC. Existing project handler test
doubles continue to implement only `ProjectLibraryApplicationService`.

- [ ] **Step 4: Implement the engine gateway**

Define:

```ts
export interface FoundationEngineGateway {
  build(input: {
    projectRoot: string;
    resumeIncomplete: boolean;
    onProgress(event: BuildBibleProgressEvent): void;
    shouldStop(): boolean;
  }): Promise<void>;
  read(projectRoot: string): Promise<FoundationReviewResult>;
}
```

The real gateway dynamically imports `novel-loop-engine/desktop`, calls
`buildDesktopStoryBible`, and calls `readDesktopStoryBible` for the four fixed
strategy files. No arbitrary relative path may enter the method.

- [ ] **Step 5: Implement the background task service**

Store tasks in a private `Map<string, InternalFoundationTask>`. Start generation
without awaiting it:

```ts
const publicTask = this.createTask(projectKey);
this.tasks.set(publicTask.taskId, internalTask);
this.activeByProject.set(projectKey, publicTask.taskId);
void this.run(internalTask, projectRoot, resumeIncomplete);
return publicTask;
```

Map engine stages to public stages, copy all returned tasks through
`FoundationTaskSchema.parse`, and map internal errors through one exhaustive
`toFoundationErrorKind(error)` function. Remove the project from
`activeByProject` in `finally`, but retain the latest 100 terminal tasks.

- [ ] **Step 6: Run service and project tests**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/projectFoundationService.test.ts tests/main/projectLibraryService.test.ts
corepack pnpm --dir apps/desktop check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/foundation apps/desktop/src/main/projects/ProjectLibraryService.ts apps/desktop/tests/main/projectFoundationService.test.ts apps/desktop/tests/main/projectLibraryService.test.ts
git commit -m "feat(desktop): run Story Foundation background tasks"
```

---

### Task 4: Trusted IPC And Preload Wiring

**Files:**
- Create: `apps/desktop/src/main/ipc/registerFoundationHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/tests/main/foundationHandlers.test.ts`
- Modify: `apps/desktop/tests/preload/preloadBoundary.test.ts`
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`

**Interfaces:**
- Consumes: `ProjectFoundationApplicationService` and Task 2 contracts.
- Produces: four trusted IPC handlers and four narrow preload methods.
- Guarantees: unknown fields and untrusted senders are rejected before service
  invocation.

- [ ] **Step 1: Write failing handler and preload tests**

Assert exact channels and strict request handling:

```ts
expect(registrations.map(({ channel }) => channel)).toEqual([
  IPC_CHANNELS.foundationStart,
  IPC_CHANNELS.foundationGet,
  IPC_CHANNELS.foundationCancel,
  IPC_CHANNELS.foundationRead
]);

await expect(handlerFor(IPC_CHANNELS.foundationStart)(
  trustedEvent,
  { projectKey, projectRoot: '/private/path' }
)).rejects.toThrow();
expect(service.start).not.toHaveBeenCalled();
```

Extend the Electron smoke to assert:

```ts
expect(await page.evaluate(() => Object.keys(window.novelLoop.foundation)))
  .toEqual(['start', 'get', 'cancel', 'read']);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/foundationHandlers.test.ts tests/preload/preloadBoundary.test.ts
```

Expected: FAIL because handlers and preload methods do not exist.

- [ ] **Step 3: Register strict handlers**

For each channel:

```ts
assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
const parsed = FoundationStartRequestSchema.parse(request);
return FoundationTaskSchema.parse(await service.start(parsed.projectKey));
```

Use the corresponding strict request and result schema for get, cancel, and
read.

- [ ] **Step 4: Expose narrow preload methods**

Each method calls a literal IPC channel:

```ts
start: async (request) => {
  const response: unknown = await ipcRenderer.invoke(
    IPC_CHANNELS.foundationStart,
    request
  );
  return response as FoundationTask;
}
```

Do not import Zod or any Node module into preload.

- [ ] **Step 5: Wire service in Electron main**

Construct one `ProjectFoundationService` with the existing
`ProjectLibraryService` and `EngineFoundationGateway`, then call
`registerFoundationHandlers`. Do not change BrowserWindow or session security
configuration.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/main/foundationHandlers.test.ts tests/preload/preloadBoundary.test.ts
corepack pnpm --dir apps/desktop check
```

Commit:

```bash
git add apps/desktop/src/main/ipc/registerFoundationHandlers.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/tests/main/foundationHandlers.test.ts apps/desktop/tests/preload/preloadBoundary.test.ts apps/desktop/tests/e2e/electron-smoke.test.ts
git commit -m "feat(desktop): expose trusted Story Foundation IPC"
```

---

### Task 5: Author-facing Generation And Review UI

**Files:**
- Create: `apps/desktop/src/renderer/src/features/foundation/FoundationGenerationView.tsx`
- Create: `apps/desktop/src/renderer/src/features/foundation/FoundationReview.tsx`
- Modify: `apps/desktop/src/renderer/src/features/projects/ProjectOverview.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Create: `apps/desktop/src/renderer/src/styles/foundation.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/tests/renderer/foundationGeneration.test.tsx`
- Create: `apps/desktop/tests/renderer/foundationReview.test.tsx`
- Modify: `apps/desktop/tests/renderer/projectLibrary.test.tsx`

**Interfaces:**
- Consumes: `window.novelLoop.foundation`.
- Produces: confirmation, background progress, cooperative stop, retry, and
  read-only four-document review routes.
- Guarantees: normal UI contains no paths, run IDs, schemas, error codes,
  provider flags, or JSONL.

- [ ] **Step 1: Write failing generation tests**

Cover confirmation before invocation, polling, cancellation, retry, and
refresh:

```tsx
test('requires confirmation before starting generation', async () => {
  render(<App />);
  await openIncompleteProject();
  await user.click(screen.getByRole('button', {
    name: '准备生成故事基础'
  }));

  expect(screen.getByRole('heading', {
    name: '生成故事基础'
  })).toBeVisible();
  expect(api.foundation.start).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', {
    name: '开始生成'
  }));
  expect(api.foundation.start).toHaveBeenCalledWith({ projectKey });
});

test('shows current stage and requests a safe stop', async () => {
  api.foundation.start.mockResolvedValue(runningStoryBibleTask);
  api.foundation.get.mockResolvedValue(runningGenreContractTask);

  render(<App />);
  await startFoundation();

  expect(await screen.findByText('正在整理类型边界')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '完成当前步骤后停止' }));
  expect(api.foundation.cancel).toHaveBeenCalledWith({
    taskId: runningStoryBibleTask.taskId
  });
});
```

Failure tests must verify natural-language messages for unavailable Codex,
login required, usage limit, timeout, invalid output, project unavailable, and
unexpected failure.

- [ ] **Step 2: Write failing review tests**

```tsx
test('reads all four foundation documents without technical metadata', async () => {
  api.foundation.read.mockResolvedValue(completeReview);
  render(<App />);
  await openCompleteProject();
  await user.click(screen.getByRole('button', { name: '查看故事基础' }));

  expect(await screen.findByRole('heading', { name: '故事基础' })).toBeVisible();
  expect(screen.getByText('这是一份生成草稿，尚未写入正式故事状态。')).toBeVisible();
  expect(screen.queryByText(/run_|strategy\/|schema|jsonl/i)).not.toBeInTheDocument();
});
```

Test keyboard focus on route heading and document navigation.

- [ ] **Step 3: Run renderer tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/renderer/foundationGeneration.test.tsx tests/renderer/foundationReview.test.tsx tests/renderer/projectLibrary.test.tsx
```

Expected: FAIL because routes and views do not exist.

- [ ] **Step 4: Enable the Project Overview action**

Change `ProjectOverview` props:

```ts
interface ProjectOverviewProps {
  onBack: () => void;
  onPrepareFoundation: () => void;
  onReviewFoundation: () => void;
  project: ProjectSummary;
}
```

Render one enabled primary action:

- incomplete: `准备生成故事基础`;
- complete: `查看故事基础`.

Keep global planning visibly unavailable without adding a clickable planning
control.

- [ ] **Step 5: Implement generation state and polling**

`FoundationGenerationView` starts only after explicit confirmation. Poll every
750 ms while status is `queued`, `running`, or `stop_requested`. Clear timers
on unmount and ignore stale responses with a monotonic request token.

Render fixed stage labels:

```ts
const STAGE_LABELS = {
  preparing: '正在读取创意与项目资料',
  story_bible: '正在构建故事核心',
  genre_contract: '正在整理类型边界',
  reader_promise: '正在明确读者期待',
  style_guide: '正在形成写作风格',
  finalizing: '正在检查生成结果',
  completed: '故事基础已准备完成'
} satisfies Record<FoundationStage, string>;
```

On success, invoke `projects.open(project.projectKey)` to refresh the project
summary, then route to Foundation Review.

- [ ] **Step 6: Implement the reading surface**

Use a stable four-item document navigation and one constrained reading column.
Render markdown as safe plain text paragraphs/headings in this milestone; do
not add HTML injection or a runtime markdown dependency. Preserve source text
in memory only and never expose its path.

- [ ] **Step 7: Add restrained responsive styles**

Use existing tokens and:

- maximum reading measure of 76 characters;
- stable 240 px document navigation on desktop;
- stacked navigation at widths below 840 px;
- no nested cards;
- visible keyboard focus;
- reduced-motion handling for progress animation;
- no gradient, decorative orb, or dashboard grid.

- [ ] **Step 8: Run renderer tests and commit**

Run:

```bash
corepack pnpm --dir apps/desktop vitest run tests/renderer/foundationGeneration.test.tsx tests/renderer/foundationReview.test.tsx tests/renderer/projectLibrary.test.tsx
corepack pnpm --dir apps/desktop check
```

Commit:

```bash
git add apps/desktop/src/renderer apps/desktop/tests/renderer
git commit -m "feat(desktop): add Story Foundation author workflow"
```

---

### Task 6: State Protection And Integration Regression

**Files:**
- Create: `apps/desktop/tests/main/foundationStateProtection.test.ts`
- Modify: `tests/unit/desktopStoryBible.test.ts`
- Modify: `apps/desktop/tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: completed engine and desktop workflow.
- Produces: regression evidence that Story State, queue, and canonical chapter
  artifacts are untouched.

- [ ] **Step 1: Write failing protection tests**

Create a project, hash protected files, run the lifecycle-capable `buildBible`
with the mock provider, and assert:

```ts
expect(await sha256(paths.storyState())).toBe(before.storyState);
expect(await sha256(paths.chapterQueue())).toBe(before.chapterQueue);
expect(await fileStore.exists(paths.chapterDir(1))).toBe(false);
expect(await fileStore.exists(path.join(paths.strategyDir(), 'story_bible.md')))
  .toBe(true);
```

Also assert no snapshot, canon patch, state diff, or commit report was created.

- [ ] **Step 2: Run protection tests and verify behavior**

Run:

```bash
corepack pnpm vitest run tests/unit/desktopStoryBible.test.ts
corepack pnpm --dir apps/desktop vitest run tests/main/foundationStateProtection.test.ts tests/renderer/App.test.tsx
```

If a test fails, make the smallest boundary correction in the owning engine,
main, or renderer module. Do not weaken the assertion.

- [ ] **Step 3: Run all root and desktop unit/integration tests**

Run:

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/desktopStoryBible.test.ts apps/desktop/tests/main/foundationStateProtection.test.ts apps/desktop/tests/renderer/App.test.tsx
git commit -m "test(desktop): protect state during Story Foundation generation"
```

---

### Task 7: Operator Documentation And Real Electron Verification

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`

**Interfaces:**
- Produces: local operator instructions and final security verification.

- [ ] **Step 1: Update desktop documentation**

Document:

- Story Foundation generation requires local Codex readiness.
- Generation consists of four visible stages and can take several minutes.
- Stop requests take effect after the current Codex step.
- Failed or cancelled incomplete generation can be retried.
- Completed Story Foundation is read-only in this milestone.
- Story State is not modified.

- [ ] **Step 2: Update changelog**

Add an unreleased desktop section containing the author workflow, safe
background task, read-only review, cancellation semantics, and state protection.

- [ ] **Step 3: Run final non-destructive verification**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e:required
git diff --check
git status --short
```

Expected: all builds and tests pass; required Electron smoke launches with a
working Chromium sandbox and no insecure flags.

- [ ] **Step 4: Manual Ubuntu author smoke**

Run:

```bash
corepack pnpm desktop:dev
```

Verify:

1. Open an incomplete project.
2. Confirm generation is not invoked before `开始生成`.
3. Confirm stage progress is readable and the stop wording is accurate.
4. Complete generation with local Codex when quota is available.
5. Review all four generated documents.
6. Return to overview and confirm Story Foundation is ready.
7. Confirm latest committed chapter remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/README.md CHANGELOG.md apps/desktop/tests/e2e/electron-smoke.test.ts
git commit -m "docs(desktop): document Story Foundation workflow"
```

## Completion Criteria

- Four foundation artifacts are generated through the existing Codex boundary.
- The desktop exposes only opaque, schema-validated task and document data.
- The author sees confirmation, progress, stop, retry, and review states.
- Complete artifacts are protected from overwrite.
- Story State and chapter queue are byte-identical before and after generation.
- Root and desktop suites pass.
- Required Electron security smoke passes without sandbox bypass.
