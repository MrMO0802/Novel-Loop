# Novel Loop Desktop Project Library Design

Status: Approved

Date: 2026-07-27

Target platform: Ubuntu 24.04

Parent specification:
`docs/superpowers/specs/2026-07-24-novel-loop-desktop-product-design.md`

## 1. Goal

Turn the current Project Library empty state into the first usable desktop
workflow. An author can create a local Novel Loop project, open an existing
project, return to recent projects, and enter a read-only project overview
without learning CLI commands, project IDs, JSON schemas, or filesystem
internals.

This milestone does not call Codex or generate Story Bible, planning, chapter,
diagnostics, revision, patch, or commit artifacts.

## 2. Scope

### Included

- Choose and persist one default library parent directory.
- Allow a different parent directory for an individual new project.
- Create a project from author-facing brief fields.
- Open one explicitly selected Novel Loop project directory.
- Validate a selected project before adding it to the library.
- Persist and list recently opened projects.
- Deduplicate projects by their canonical main-process path.
- Remove an entry from the recent list without deleting project files.
- Display a read-only project overview after create or open.
- Present cancellation and validation errors in author language.

### Excluded

- Codex calls and Story Bible generation.
- Project archive or backup execution.
- Project deletion.
- Existing-novel import.
- Project filesystem browsing inside the renderer.
- Story State, queue, chapter, snapshot, or run mutation after initialization.
- DeepSeek, OpenAI API, Web UI, and CodexAgentConnector.

## 3. Selected Approach

Use a main-process project registry plus a narrow Engine desktop adapter.

```text
React renderer
  -> typed contextBridge project API
  -> schema-validated named IPC handlers
  -> Electron main ProjectLibraryService
  -> native directory dialog / ProjectRegistry
  -> Novel Loop Engine desktop adapter
```

The renderer never receives a real project path. Native dialogs may display a
path to the user, but their result stays in Electron main. Renderer-facing
objects use an opaque `projectKey` and a non-sensitive location label.

The project registry is application metadata stored below Electron
`app.getPath('userData')`. It is not a Novel Loop project artifact. Registry
writes use temporary-file plus rename and a strict schema.

## 4. Author Workflow

### Empty Library

The empty state presents two real commands:

- Primary: `新建小说`
- Secondary: `打开已有项目`

`返回环境检查` becomes a tertiary command.

### Create Project

The create surface collects:

- Work title, required.
- Core idea, required.
- Genre, optional.
- Protagonist, optional.
- World premise, optional.

On the first creation, the author selects a library parent directory with an
Electron native directory dialog. The selection becomes the default for future
projects. A later creation can select a different parent directory without
changing the saved default.

Novel Loop generates an internal project ID and folder name. The author is not
asked to construct a CLI-compatible ID. The generated `brief.md` contains the
work title and supplied brief fields. No AI generation occurs.

Successful creation:

1. Initializes the project through the Engine.
2. Validates the initialized project.
3. Adds or updates the recent-project registry entry.
4. Opens the read-only project overview.

### Open Existing Project

The author selects one concrete project directory. Main derives its parent and
folder identity, then asks the Engine adapter to validate and summarize it.

Successful selection is deduplicated by canonical path, recorded as recently
opened, and opened in the project overview. Canceling the native dialog writes
nothing.

### Recent Projects

The Project Library lists recent entries by most-recently-opened time. Each
entry displays:

- Work title.
- Current committed chapter number.
- Health: ready or needs attention.
- Last opened time.
- A short brief excerpt when available.

The entry command opens the project after revalidation. Removing an entry only
changes the registry and never deletes project files.

## 5. Project Overview

The first overview is deliberately read-only. It displays:

- Work title.
- Core idea excerpt.
- Latest committed chapter.
- Project health.
- Whether Story Bible exists.
- Whether global planning exists.
- The next recommended action in author language.

For a newly initialized project, the next action is:
`准备生成故事基础`. The action is visibly unavailable in this milestone, with
copy stating that generation arrives in the next workflow stage. It is not a
fake command.

The overview provides working navigation back to the Project Library.

## 6. Renderer Contract

The preload API expands with named project methods only:

```ts
interface NovelLoopDesktopApi {
  system: {
    getReadiness(): Promise<SystemReadiness>;
  };
  projects: {
    list(): Promise<ProjectLibraryResult>;
    chooseDefaultLibrary(): Promise<LibraryLocationSelection>;
    create(input: CreateProjectRequest): Promise<ProjectOpenResult>;
    openExisting(): Promise<ProjectOpenResult>;
    open(projectKey: string): Promise<ProjectOpenResult>;
    remove(projectKey: string): Promise<ProjectLibraryResult>;
  };
}
```

No generic `invoke`, path argument, filesystem method, shell method, Codex
method, or raw Engine error crosses preload.

### CreateProjectRequest

```ts
{
  title: string;
  coreIdea: string;
  genre?: string;
  protagonist?: string;
  worldPremise?: string;
  useDifferentLocation: boolean;
}
```

All strings are trimmed and length bounded by the shared Zod schema in main.

### ProjectSummary

```ts
{
  projectKey: string;
  title: string;
  latestCommittedChapter: number;
  health: 'ready' | 'needs_attention';
  lastOpenedAt: string;
  briefExcerpt: string | null;
  locationLabel: string;
  storyBibleAvailable: boolean;
  globalPlanAvailable: boolean;
}
```

`projectKey` is an opaque registry identifier. `locationLabel` is a bounded
directory label, not an absolute path.

### ProjectLibraryResult

```ts
{
  projects: ProjectSummary[];
  defaultLocation: {
    configured: boolean;
    locationLabel: string | null;
  };
  warning: 'registry_unavailable' | null;
}
```

The result is sorted by `lastOpenedAt` descending. A registry warning never
contains the corrupt file path or parser details.

### LibraryLocationSelection

```ts
| { selection: 'selected'; locationLabel: string }
| { selection: 'cancelled' }
```

### Result Semantics

Dialog operations return explicit result variants:

- `opened`
- `created`
- `cancelled`
- `invalid_project`
- `location_required`
- `location_unavailable`
- `project_exists`
- `failed`

The renderer maps these variants to fixed Chinese message keys. Internal error
codes and exception messages remain in main.

## 7. Main-Process Components

### ProjectLibraryService

Owns use-case sequencing:

- list registry summaries;
- choose a default parent directory;
- create and validate a project;
- select, validate, and open an existing project;
- revalidate a recent entry before opening;
- remove a recent entry.

The service depends on interfaces for native dialogs, registry persistence,
and the Engine adapter so behavior can be tested without launching Electron.

### ProjectRegistry

The registry schema contains:

```ts
{
  schemaVersion: 1;
  defaultLibraryRoot: string | null;
  projects: Array<{
    projectKey: string;
    projectRoot: string;
    title: string;
    addedAt: string;
    lastOpenedAt: string;
  }>;
}
```

Real paths exist only in main-owned storage. Reads validate the full file.
Writes use a sibling temporary file followed by rename. Corrupt registry data
does not overwrite itself; the service returns an empty safe library plus a
non-destructive warning.

### NativeProjectDialog

Wraps `dialog.showOpenDialog`:

- default library: `openDirectory` and `createDirectory`;
- existing project: `openDirectory`;
- cancellation returns a variant and is not an error.

### IPC

Each project command uses a fixed channel. Handlers:

1. Verify the sender URL.
2. Parse the request with a strict Zod schema.
3. Call one named application-service method.
4. Parse the response with a strict Zod schema.

## 8. Engine Desktop Adapter

The root package adds desktop-only adapters without changing CLI behavior.

### Create From Brief Text

The existing initialization implementation is refactored around one internal
function that accepts validated brief content. Existing `initProject` continues
to support `briefPath`. The desktop adapter supplies generated Markdown text
without creating an unvalidated temporary business file.

All project directories, `brief.md`, `config.json`, and
`state/story_state.json` remain written through `FileStore` and its atomic
writer.

### Inspect Project Directory

The adapter:

1. Resolves the selected directory in main/Engine only.
2. Derives `projectId` and parent directory.
3. Runs `validateProject`.
4. Reads config, Story State, brief, and selected existence flags through
   `FileStore` and schemas.
5. Extracts the first Markdown H1 as the title, falling back to project ID.
6. Returns a safe summary without any path.

The adapter never calls Codex and never mutates an existing project.

## 9. Internal Project Identity

Created projects use a collision-resistant lowercase ID:

```text
novel-YYYYMMDD-HHmmss-<6 lowercase hex characters>
```

The ID satisfies the existing `ProjectIdSchema` and is not shown in the default
UI. The visible work title remains independent from the storage identifier.

Registry `projectKey` is generated independently and cannot be used by the
renderer to infer a filesystem path.

## 10. Error And Recovery Behavior

| Condition | Author-facing behavior |
|---|---|
| Dialog canceled | Return to the unchanged screen |
| No default library selected | Ask the author to choose a location |
| Parent directory unavailable | “无法使用这个保存位置，请重新选择” |
| Existing directory is not a project | “所选文件夹不是可识别的 Novel Loop 项目” |
| Core project data is invalid | “这个项目的故事档案需要检查，暂时无法打开” |
| Generated project ID collision | Generate one replacement ID and retry |
| Project already in recent list | Update its last-opened time; do not duplicate |
| Registry is corrupt | Preserve the corrupt file, show an empty list and warning |
| Initialization fails | Do not add a registry entry; surface a fixed safe message |

No error path deletes project data. No operation modifies Story State for an
existing project.

## 11. Security Invariants

- Renderer cannot import Node.js or Electron.
- Renderer never receives or submits an absolute path.
- Renderer cannot choose arbitrary IPC channel names.
- Native dialogs are invoked only in Electron main.
- Registry paths never cross preload.
- Registry and all IPC payloads are schema validated.
- Existing project open is read-only.
- Creation writes only a new project through the Engine.
- No Codex command, shell command, auth data, raw JSONL, Story State commit,
  queue mutation, or snapshot operation is introduced.
- Sandboxing, context isolation, navigation denial, popup denial, and
  permission denial remain unchanged.

## 12. Testing Strategy

### Engine

- Create from brief text produces the standard project skeleton.
- Existing path-based initialization remains compatible.
- Desktop inspection returns a safe summary.
- Invalid or mismatched project directories are rejected.
- Existing Story State is unchanged by inspection.

### Main

- Registry schema, ordering, deduplication, removal, and atomic replacement.
- Corrupt registry is preserved.
- Dialog cancellation has no registry or project side effect.
- Create sequences location, Engine initialization, validation, and registry.
- Open rejects invalid projects and stores valid projects.
- Main responses contain no absolute paths or raw errors.

### IPC And Preload

- Every project channel rejects untrusted senders and unknown fields.
- Every response is schema validated in main.
- Preload exposes only named project methods.
- Sandboxed preload remains free of third-party runtime dependencies.

### Renderer

- Empty state exposes working create and open commands.
- Create form validates required fields.
- Location cancellation is recoverable.
- Successful create/open enters project overview.
- Recent projects render and reopen.
- Remove-from-list requires confirmation and does not imply deletion.
- Internal paths and error codes never render.

### Electron Smoke

- Existing system readiness smoke remains green.
- Runtime preload API contains only `system` and `projects`.
- Renderer still has no Node `process` or `require`.
- Project Library boot does not invoke Codex.

## 13. Acceptance Criteria

1. A clean userData directory opens a Project Library with working
   `新建小说` and `打开已有项目` commands.
2. First creation requests a library parent directory and remembers it.
3. Creation writes a schema-valid standard Novel Loop project through the
   Engine and enters its overview.
4. Opening a valid existing project adds one deduplicated recent entry and
   enters its overview.
5. Invalid project selection produces a safe Chinese explanation and no
   registry entry.
6. Restarting the application restores recent projects.
7. Removing a recent entry does not delete or alter its project directory.
8. No renderer payload contains an absolute path, auth data, raw Engine error,
   Story State body, or generic IPC capability.
9. Existing project Story State and chapter queue hashes remain unchanged
   through list, select, validate, open, and remove operations.
10. Typecheck, unit tests, root regression, desktop build, and required real
    Electron smoke pass.
