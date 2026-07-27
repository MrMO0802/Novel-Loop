# Novel Loop Desktop Project Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop Project Library placeholder with secure create, open, recent-project, remove-from-list, and read-only project overview workflows.

**Architecture:** Keep all paths and filesystem privileges in Electron main. Root Engine desktop adapters create and inspect Novel Loop projects; a main-owned atomic registry maps opaque renderer keys to real paths; strict named IPC exposes only author-facing summaries. Renderer remains browser-only and never receives an absolute path.

**Tech Stack:** Node.js 20+, TypeScript, Zod, Electron 43, electron-vite 5, React 19, Vitest, Testing Library, Playwright Electron.

## Global Constraints

- Target Ubuntu 24.04 first.
- Follow `docs/superpowers/specs/2026-07-27-novel-loop-desktop-project-library-design.md`.
- Do not call Codex from any Project Library operation.
- Do not add DeepSeek, OpenAI API, Web UI, or CodexAgentConnector.
- Do not expose Node.js, Electron, `ipcRenderer`, generic IPC, absolute paths, raw Engine errors, auth data, or raw JSONL to renderer.
- Existing-project list, validate, open, and remove operations must not mutate Story State, chapter queue, chapters, snapshots, runs, or project artifacts.
- New project initialization must write only through the Novel Loop Engine and `FileStore`.
- Registry data is Electron application metadata under `app.getPath('userData')`, not a project artifact.
- Main canonicalizes selected existing directories with `fs.realpath`; path
  aliases and symlinks must not create duplicate recent-project entries.
- All IPC request and response payloads are strict Zod schemas in Electron main.
- Sandboxed preload must have no third-party runtime dependency.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, navigation denial, popup denial, and permission denial unchanged.
- Use Chinese author-facing messages and message keys; do not render internal error codes.
- No fake buttons. A visible command must work or be explicitly marked unavailable with a reason.

---

## Planned File Structure

```text
src/
├── app/initProject.ts
└── desktop/
    ├── index.ts
    └── projectLibrary.ts

tests/unit/
└── desktopProjectLibrary.test.ts

apps/desktop/src/
├── main/
│   ├── index.ts
│   ├── dialogs/
│   │   └── NativeProjectDialog.ts
│   ├── ipc/
│   │   └── registerProjectHandlers.ts
│   └── projects/
│       ├── EngineProjectGateway.ts
│       ├── ProjectLibraryService.ts
│       └── ProjectRegistryStore.ts
├── preload/index.ts
├── shared/
│   ├── desktopApi.ts
│   ├── ipcChannels.ts
│   └── projectContract.ts
└── renderer/src/
    ├── App.tsx
    ├── features/projects/
    │   ├── CreateProjectView.tsx
    │   ├── ProjectLibrary.tsx
    │   └── ProjectOverview.tsx
    ├── i18n/messages.zh-CN.ts
    └── styles/project-library.css

apps/desktop/tests/
├── main/
│   ├── projectLibraryService.test.ts
│   ├── projectRegistryStore.test.ts
│   └── projectHandlers.test.ts
├── preload/preloadBoundary.test.ts
├── renderer/projectLibrary.test.tsx
└── e2e/electron-smoke.test.ts
```

## Task 1: Engine Desktop Project Creation And Inspection

**Files:**

- Modify: `src/app/initProject.ts`
- Create: `src/desktop/projectLibrary.ts`
- Modify: `src/desktop/index.ts`
- Create: `tests/unit/desktopProjectLibrary.test.ts`

**Interfaces:**

- Produces:

```ts
export interface DesktopProjectBriefInput {
  title: string;
  coreIdea: string;
  genre?: string;
  protagonist?: string;
  worldPremise?: string;
}

export interface CreateDesktopProjectInput {
  projectId: string;
  projectsRoot: string;
  brief: DesktopProjectBriefInput;
}

export interface InspectDesktopProjectInput {
  projectRoot: string;
}

export type DesktopProjectInspection =
  | {
      valid: true;
      projectId: string;
      title: string;
      briefExcerpt: string | null;
      latestCommittedChapter: number;
      storyBibleAvailable: boolean;
      globalPlanAvailable: boolean;
    }
  | {
      valid: false;
      reason: 'invalid_project' | 'project_data_invalid';
    };

export function createDesktopBriefMarkdown(
  input: DesktopProjectBriefInput
): string;

export function createDesktopProject(
  input: CreateDesktopProjectInput
): Promise<void>;

export function inspectDesktopProject(
  input: InspectDesktopProjectInput
): Promise<DesktopProjectInspection>;
```

- Existing `initProject({ briefPath })` behavior and CLI remain unchanged.

- [ ] **Step 1: Write failing Engine tests**

Create `tests/unit/desktopProjectLibrary.test.ts` with focused tests:

```ts
test('creates a standard project from author brief fields', async () => {
  const projectsRoot = await makeTempDir();
  await createDesktopProject({
    projectId: 'novel-20260727-120000-abc123',
    projectsRoot,
    brief: {
      title: '雾港来信',
      coreIdea: '一名夜班邮差收到来自未来的退信。',
      genre: '悬疑',
      protagonist: '林岚'
    }
  });

  const paths = new ProjectPaths(
    projectsRoot,
    'novel-20260727-120000-abc123'
  );
  expect(await new FileStore().readText(paths.brief())).toContain('# 雾港来信');
  expect(await validateProject({
    projectId: paths.projectId,
    projectsRoot
  })).toMatchObject({ ok: true });
});

test('inspects an existing project without returning its path', async () => {
  const before = await hashStoryState(projectRoot);
  const inspection = await inspectDesktopProject({ projectRoot });
  const after = await hashStoryState(projectRoot);

  expect(inspection).toMatchObject({
    valid: true,
    title: '雾港来信',
    latestCommittedChapter: 0
  });
  expect(JSON.stringify(inspection)).not.toContain(projectRoot);
  expect(after).toBe(before);
});

test('rejects a selected directory whose folder does not match projectId', async () => {
  const inspection = await inspectDesktopProject({
    projectRoot: mismatchedProjectRoot
  });
  expect(inspection).toEqual({
    valid: false,
    reason: 'invalid_project'
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/desktopProjectLibrary.test.ts
```

Expected: FAIL because the desktop project adapter does not exist.

- [ ] **Step 3: Refactor initialization around validated brief content**

In `src/app/initProject.ts`, preserve the public `InitProjectInput` and add one
internal function:

```ts
async function initializeProjectWithBrief(
  input: {
    projectId: string;
    projectsRoot: string;
    brief: string;
  },
  fileStore: FileStore
): Promise<InitProjectResult>
```

`initProject()` reads `briefPath`, then delegates to this function. Export a
new `initProjectFromBriefText()` that validates non-empty brief text and
delegates to the same function. Directory creation, config, Story State, and
all writes remain identical and continue through `FileStore`.

- [ ] **Step 4: Implement the desktop adapter**

`createDesktopBriefMarkdown()` must:

- trim all fields;
- require title and core idea;
- produce deterministic Markdown headings;
- omit optional empty sections;
- end with one newline.

`inspectDesktopProject()` must:

- resolve the selected root;
- derive parent and folder name;
- reject folder names that fail `ProjectIdSchema`;
- read `config.json` and require `config.projectId === folder name`;
- run `validateProject`;
- read Story State through `StoryStateSchema`;
- extract only bounded title and brief excerpt;
- check Story Bible and global outline existence;
- return no path or raw validation message.

- [ ] **Step 5: Verify Engine behavior**

Run:

```bash
corepack pnpm build
corepack pnpm exec vitest run tests/unit/desktopProjectLibrary.test.ts tests/integration/initValidate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/initProject.ts src/desktop tests/unit/desktopProjectLibrary.test.ts
git commit -m "feat(desktop): add project creation adapter"
```

## Task 2: Shared Contract And Atomic Project Registry

**Files:**

- Create: `apps/desktop/src/shared/projectContract.ts`
- Create: `apps/desktop/src/main/projects/ProjectRegistryStore.ts`
- Create: `apps/desktop/tests/main/projectRegistryStore.test.ts`
- Modify: `apps/desktop/tsconfig.node.json`

**Interfaces:**

- Produces `ProjectSummarySchema`, `ProjectLibraryResultSchema`,
  `CreateProjectRequestSchema`, `ProjectOpenResultSchema`, and request schemas
  for every project command.
- Produces:

```ts
export interface ProjectRegistryStore {
  load(): Promise<{
    registry: ProjectRegistry;
    warning: 'registry_unavailable' | null;
  }>;
  save(registry: ProjectRegistry): Promise<void>;
}
```

- Registry data never imports into renderer or preload.

- [ ] **Step 1: Define tests for the schema-first renderer contract**

In `projectRegistryStore.test.ts`, import the shared schemas and assert:

```ts
expect(() => ProjectSummarySchema.parse({
  projectKey: 'project_0123456789abcdef01234567',
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-27T04:00:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: false,
  globalPlanAvailable: false
})).not.toThrow();

expect(() => ProjectSummarySchema.parse({
  // same fields
  projectRoot: '/home/author/novels/private'
})).toThrow();
```

Write registry tests for:

- missing file returns an empty schema-valid registry;
- save/load round trip;
- projects sort by `lastOpenedAt` in service-facing results;
- corrupt JSON returns `registry_unavailable` without replacing the file;
- failed rename preserves the previous registry;
- duplicate canonical paths are not representable after upsert helper use;
- remove deletes one registry entry only.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectRegistryStore.test.ts
```

Expected: FAIL because schemas and registry store do not exist.

- [ ] **Step 3: Implement strict shared schemas**

`projectContract.ts` must use strict objects and bounded strings. Define result
variants as a discriminated union:

```ts
export const ProjectOpenResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('created'),
    project: ProjectSummarySchema
  }).strict(),
  z.object({
    outcome: z.literal('opened'),
    project: ProjectSummarySchema
  }).strict(),
  z.object({ outcome: z.literal('cancelled') }).strict(),
  z.object({ outcome: z.literal('invalid_project') }).strict(),
  z.object({ outcome: z.literal('location_required') }).strict(),
  z.object({ outcome: z.literal('location_unavailable') }).strict(),
  z.object({ outcome: z.literal('project_exists') }).strict(),
  z.object({ outcome: z.literal('failed') }).strict()
]);
```

Do not include an absolute path field in any exported shared schema.

- [ ] **Step 4: Implement atomic registry persistence**

`ProjectRegistryStore.ts` must:

- validate loaded data with internal `ProjectRegistrySchema`;
- use `path.resolve` and `path.join`;
- create the userData directory if missing;
- write `${registryPath}.tmp-<random>` with mode `0o600`;
- rename temporary file over the target;
- remove only its temporary file on error;
- never replace corrupt original data during `load`;
- expose pure helpers `upsertRegistryProject()` and
  `removeRegistryProject()` for deterministic tests.

- [ ] **Step 5: Verify registry behavior**

Run:

```bash
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectRegistryStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/projectContract.ts \
  apps/desktop/src/main/projects \
  apps/desktop/tests/main/projectRegistryStore.test.ts \
  apps/desktop/tsconfig.node.json
git commit -m "feat(desktop): add atomic project registry"
```

## Task 3: Main Project Library Service And Native Dialog

**Files:**

- Create: `apps/desktop/src/main/dialogs/NativeProjectDialog.ts`
- Create: `apps/desktop/src/main/projects/EngineProjectGateway.ts`
- Create: `apps/desktop/src/main/projects/ProjectLibraryService.ts`
- Create: `apps/desktop/tests/main/projectLibraryService.test.ts`

**Interfaces:**

```ts
export interface ProjectDialogPort {
  chooseDefaultLibrary(): Promise<string | null>;
  chooseProjectDirectory(): Promise<string | null>;
  chooseAlternateLibrary(): Promise<string | null>;
}

export interface ProjectEngineGateway {
  create(input: {
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }): Promise<void>;
  inspect(projectRoot: string): Promise<DesktopProjectInspection>;
}

export interface ProjectLibraryApplicationService {
  list(): Promise<ProjectLibraryResult>;
  chooseDefaultLibrary(): Promise<LibraryLocationSelection>;
  create(input: CreateProjectRequest): Promise<ProjectOpenResult>;
  openExisting(): Promise<ProjectOpenResult>;
  open(projectKey: string): Promise<ProjectOpenResult>;
  remove(projectKey: string): Promise<ProjectLibraryResult>;
}
```

- [ ] **Step 1: Write service-level failing tests**

Use temp directories plus fake dialog and gateway ports. Cover:

```ts
test('first create requests and remembers a default library', async () => {
  dialog.defaultLibraryResult = libraryRoot;
  gateway.createResult = undefined;
  gateway.inspection = validInspection;

  const selected = await service.chooseDefaultLibrary();
  const created = await service.create({
    title: '雾港来信',
    coreIdea: '一名夜班邮差收到来自未来的退信。',
    useDifferentLocation: false
  });

  expect(selected).toEqual({
    selection: 'selected',
    locationLabel: path.basename(libraryRoot)
  });
  expect(created).toMatchObject({
    outcome: 'created',
    project: { title: '雾港来信' }
  });
  expect(JSON.stringify(created)).not.toContain(libraryRoot);
});

test('cancelled open writes nothing', async () => {
  dialog.projectDirectoryResult = null;
  const before = await registrySnapshot();
  expect(await service.openExisting()).toEqual({ outcome: 'cancelled' });
  expect(await registrySnapshot()).toEqual(before);
  expect(gateway.inspect).not.toHaveBeenCalled();
});

test('opening an invalid directory does not add it', async () => {
  dialog.projectDirectoryResult = invalidRoot;
  gateway.inspection = { valid: false, reason: 'invalid_project' };
  expect(await service.openExisting()).toEqual({
    outcome: 'invalid_project'
  });
  expect((await service.list()).projects).toHaveLength(0);
});

test('remove forgets the entry without touching its project', async () => {
  const storyHashBefore = await hashFile(storyStatePath);
  await service.remove(projectKey);
  expect(await hashFile(storyStatePath)).toBe(storyHashBefore);
  expect(await fileExists(projectRoot)).toBe(true);
});
```

Also cover:

- alternate creation location does not replace default;
- duplicate open updates time instead of adding another entry;
- opening the same project through a symlink deduplicates by canonical
  `fs.realpath`;
- recent list ordering;
- reopen revalidates;
- missing recent project becomes `needs_attention`;
- create collision retries exactly once with a new internal ID;
- Engine exception maps to `failed` without raw message;
- every renderer result contains no absolute path.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectLibraryService.test.ts
```

Expected: FAIL because the service, gateway, and dialog do not exist.

- [ ] **Step 3: Implement the native dialog**

`NativeProjectDialog` wraps only:

```ts
dialog.showOpenDialog({
  properties: ['openDirectory', 'createDirectory']
});
```

for library selection, and:

```ts
dialog.showOpenDialog({
  properties: ['openDirectory']
});
```

for existing projects. Return one normalized absolute path or `null`.

- [ ] **Step 4: Implement the Engine gateway**

Use dynamic import:

```ts
const {
  createDesktopProject,
  inspectDesktopProject
} = await import('novel-loop-engine/desktop');
```

The gateway returns Engine desktop types only to the main application service.
It never returns a path to IPC.

- [ ] **Step 5: Implement ProjectLibraryService**

Use injected clock and random-byte functions. Generate:

```text
projectId: novel-YYYYMMDD-HHmmss-<6 hex>
projectKey: project_<24 hex>
```

Map Engine inspection and registry metadata into `ProjectSummarySchema`. Use
`path.basename()` for `locationLabel`. Never include caught exception messages
in results. Canonicalize successful native selections with `fs.realpath`
before lookup or persistence. Treat a missing or unreadable selection as
`location_unavailable`. Retry project-ID generation exactly once only when the
target directory already exists or the Engine returns its typed
project-already-exists error; do not retry arbitrary initialization failures.

- [ ] **Step 6: Verify service behavior**

Run:

```bash
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectRegistryStore.test.ts \
  tests/main/projectLibraryService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/dialogs \
  apps/desktop/src/main/projects \
  apps/desktop/tests/main
git commit -m "feat(desktop): add project library service"
```

## Task 4: Validated Project IPC And Sandboxed Preload

**Files:**

- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Create: `apps/desktop/src/main/ipc/registerProjectHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/tests/main/projectHandlers.test.ts`
- Modify: `apps/desktop/tests/preload/preloadBoundary.test.ts`
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`

**Interfaces:**

- Adds six fixed channels:
  - `novel-loop:projects:list`
  - `novel-loop:projects:choose-default-library`
  - `novel-loop:projects:create`
  - `novel-loop:projects:open-existing`
  - `novel-loop:projects:open`
  - `novel-loop:projects:remove`
- Expands `window.novelLoop.projects` with the exact methods in the approved
  design.

- [ ] **Step 1: Write failing IPC contract tests**

`projectHandlers.test.ts` must assert:

- each fixed channel registers once;
- trusted renderer and strict request succeed;
- unknown request fields reject before the service call;
- untrusted sender rejects before the service call;
- a service response containing `projectRoot` rejects;
- a malformed result variant rejects;
- create request trims and enforces title/core idea bounds.

Example:

```ts
await expect(createHandler(
  trustedEvent,
  {
    title: '雾港来信',
    coreIdea: '来自未来的退信。',
    useDifferentLocation: false,
    projectRoot: '/private/path'
  }
)).rejects.toThrow();
expect(service.create).not.toHaveBeenCalled();
```

Update preload tests to require only:

```ts
window.novelLoop.projects.list
window.novelLoop.projects.chooseDefaultLibrary
window.novelLoop.projects.create
window.novelLoop.projects.openExisting
window.novelLoop.projects.open
window.novelLoop.projects.remove
```

and reject generic invoke, paths, filesystem, shell, Codex, and third-party
runtime imports.

- [ ] **Step 2: Run IPC/preload tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectHandlers.test.ts \
  tests/preload/preloadBoundary.test.ts
```

Expected: FAIL because the project channels and methods do not exist.

- [ ] **Step 3: Implement project handlers**

Reuse `assertTrustedIpcSender`. For every handler:

```ts
assertTrustedIpcSender(event.senderFrame.url, trustedRendererUrl);
const parsedRequest = RequestSchema.parse(request);
const response = await service.method(parsedRequest);
return ResponseSchema.parse(response);
```

No handler may call Electron dialog or Engine directly.

- [ ] **Step 4: Wire main composition**

After `app.whenReady()`:

1. Build registry path with:
   `path.join(app.getPath('userData'), 'project-library.json')`.
2. Construct `ProjectRegistryStore`.
3. Construct `NativeProjectDialog`.
4. Construct `EngineProjectGateway`.
5. Construct `ProjectLibraryService`.
6. Register project handlers.

Keep the existing readiness handler and security policies unchanged.

- [ ] **Step 5: Expand preload with named methods**

Preload calls fixed channels and uses type-only imports. It does not import Zod
or any main-only module. Main remains the runtime validation boundary.

- [ ] **Step 6: Strengthen real Electron smoke**

Create a temporary directory, launch Electron with
`--user-data-dir=<temporary-directory>`, and delete that directory after the
test. Assert:

```ts
expect(Object.keys(window.novelLoop)).toEqual(['system', 'projects']);
expect(Object.keys(window.novelLoop.projects)).toEqual([
  'list',
  'chooseDefaultLibrary',
  'create',
  'openExisting',
  'open',
  'remove'
]);
```

Call `projects.list()` and assert it returns an empty schema-shaped library
without invoking Codex. Continue to assert `window.require` and
`window.process` are undefined, popup is blocked, and navigation is denied.

- [ ] **Step 7: Verify and commit**

Run:

```bash
corepack pnpm build
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e:required
```

Expected: PASS.

Commit:

```bash
git add apps/desktop/src apps/desktop/tests
git commit -m "feat(desktop): expose validated project library API"
```

## Task 5: Author-Facing Project Library And Overview

**Files:**

- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/features/projects/ProjectLibrary.tsx`
- Create: `apps/desktop/src/renderer/src/features/projects/CreateProjectView.tsx`
- Create: `apps/desktop/src/renderer/src/features/projects/ProjectOverview.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Create: `apps/desktop/src/renderer/src/styles/project-library.css`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/tests/renderer/projectLibrary.test.tsx`
- Modify: `apps/desktop/tests/renderer/App.test.tsx`
- Modify: `apps/desktop/README.md`

**Interfaces:**

- `App` owns application-level route state:
  - readiness;
  - project library;
  - create project;
  - project overview.
- Feature components consume only typed callback props or
  `window.novelLoop.projects`.

- [ ] **Step 1: Write failing renderer workflow tests**

`projectLibrary.test.tsx` must cover:

```ts
test('empty library offers real create and open commands', async () => {
  installProjectApi({ projects: [] });
  render(<App />);
  await enterProjectLibrary();

  expect(screen.getByRole('button', { name: '新建小说' })).toBeEnabled();
  expect(screen.getByRole('button', {
    name: '打开已有项目'
  })).toBeEnabled();
});

test('creates a project after selecting the first default library', async () => {
  projectApi.chooseDefaultLibrary.mockResolvedValue({
    selection: 'selected',
    locationLabel: '我的小说'
  });
  projectApi.create
    .mockResolvedValueOnce({ outcome: 'location_required' })
    .mockResolvedValueOnce({
      outcome: 'created',
      project: readyProject
    });

  await submitCreateForm({
    title: '雾港来信',
    coreIdea: '一名夜班邮差收到来自未来的退信。'
  });

  expect(projectApi.chooseDefaultLibrary).toHaveBeenCalledOnce();
  expect(await screen.findByRole('heading', {
    name: '雾港来信'
  })).toBeVisible();
});

test('opens a valid existing project and enters overview', async () => {
  projectApi.openExisting.mockResolvedValue({
    outcome: 'opened',
    project: readyProject
  });
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));
  expect(await screen.findByText('最新正式章节：尚未提交')).toBeVisible();
});

test('invalid project uses author language and renders no path', async () => {
  projectApi.openExisting.mockResolvedValue({
    outcome: 'invalid_project'
  });
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '所选文件夹不是可识别的 Novel Loop 项目'
  );
  expect(document.body).not.toHaveTextContent(/\/home\/|projectRoot|json/i);
});
```

Also cover:

- required title and core idea;
- canceled dialog leaves UI unchanged;
- alternate location checkbox reaches API;
- recent list sorting and open;
- `needs_attention` state;
- remove confirmation says files are retained;
- removal calls only `projects.remove`;
- overview shows Story Bible/global planning availability;
- overview generation command is explicitly unavailable;
- keyboard focus moves to new view heading;
- loading and retry states.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/App.test.tsx \
  tests/renderer/projectLibrary.test.tsx
```

Expected: FAIL because the Project Library feature is still a placeholder.

- [ ] **Step 3: Implement Project Library layout**

Use the approved Quiet Project Space direction:

- restrained application header;
- content-first library list;
- one primary create command;
- one secondary open command;
- recent projects as individual repeated cards with radius no greater than
  8px;
- health status uses icon plus text, not color alone;
- remove-from-list uses a familiar icon button with tooltip;
- no dashboard metrics, nested cards, marketing hero, gradients, or decorative
  blobs.

The empty state must keep both actions visible in the first viewport at
1024×720.

- [ ] **Step 4: Implement create form**

The form contains:

- title input, required, maximum 120 characters;
- core idea textarea, required, maximum 2,000 characters;
- optional genre, protagonist, and world premise;
- alternate-location checkbox;
- cancel and create commands.

When `location_required` is returned, call `chooseDefaultLibrary()`. Only retry
creation after a `selected` result. Disable duplicate submission while pending.

- [ ] **Step 5: Implement read-only overview**

Display:

- title and brief excerpt;
- latest committed chapter;
- health;
- Story Bible status;
- global planning status;
- next recommended action.

Render `准备生成故事基础` as an unavailable next-stage control with an
adjacent status explanation. Provide working `返回作品库`.

- [ ] **Step 6: Add Chinese messages and responsive styling**

Every visible string must use a message key. At 1024×720 and 1440×900:

- no text overlap;
- no horizontal scroll;
- buttons retain stable dimensions;
- form labels remain associated;
- reduced-motion preference remains honored;
- focus outline remains visible.

- [ ] **Step 7: Verify renderer and desktop package**

Run:

```bash
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e:required
```

Expected: PASS.

Use Playwright with a mocked preload contract only for visual inspection of
empty, populated, create, error, and overview states at 1024×720 and
1440×900. Do not add a browser fallback to production code.

- [ ] **Step 8: Update desktop documentation**

Document:

- how the default library location works;
- that native dialogs own paths;
- that recent-list removal does not delete files;
- that project creation performs no Codex call;
- current overview limitations;
- manual Ubuntu smoke commands.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/tests/renderer \
  apps/desktop/README.md
git commit -m "feat(desktop): add usable project library"
```

## Final Verification

- [ ] Run frozen install:

```bash
corepack pnpm install --frozen-lockfile
```

- [ ] Run root build and full regression:

```bash
corepack pnpm build
corepack pnpm test
```

- [ ] Run the complete desktop release gate:

```bash
corepack pnpm --dir apps/desktop verify:release
```

- [ ] Verify formatting and worktree:

```bash
git diff --check
git status --short
```

- [ ] Run manual Ubuntu workflow:

```text
1. Start `corepack pnpm desktop:dev`.
2. Enter Project Library.
3. Create a project after choosing a default parent directory.
4. Confirm the read-only overview.
5. Return to library and confirm the recent entry.
6. Remove it from recent projects and confirm project files remain.
7. Open the same project through the native directory dialog.
8. Restart the application and confirm the recent entry persists.
```

- [ ] Dispatch an independent code review focused on renderer/main privilege
  boundaries, atomic registry durability, path leakage, and project mutation
  safety. Resolve all Critical and Important findings before acceptance.

## Milestone Acceptance

The Project Library milestone is accepted only when all ten acceptance
criteria in the approved design pass, the real Electron preload smoke runs
without sandbox bypass, and an independent review reports no Critical or
Important renderer/main privilege-boundary findings.
