# Novel Loop Desktop

Novel Loop Desktop is the production Electron foundation for the local-first
Novel Loop authoring product. The current milestone contains a secure desktop
shell, a Chinese-first first-launch readiness flow, and a usable local Project
Library.

Authors can create a new Novel Loop project from a short brief, open a valid
existing project, return to recent projects, inspect a project overview, and
generate and review a Story Foundation. This milestone does not expose global
planning, chapter writing, Story State or chapter-queue changes, chapter
commits, snapshot rollback, or archive restore.

## Architecture Boundary

```text
React renderer
  -> typed contextBridge API
  -> validated Electron IPC
  -> Electron main application service
  -> Novel Loop Engine desktop adapter
```

The renderer receives named system, project, and Story Foundation methods:

```ts
window.novelLoop.system.getReadiness();
window.novelLoop.projects.list();
window.novelLoop.projects.chooseDefaultLibrary();
window.novelLoop.projects.create(request);
window.novelLoop.projects.openExisting();
window.novelLoop.projects.open(projectKey);
window.novelLoop.projects.remove(projectKey);
window.novelLoop.foundation.start({ projectKey });
window.novelLoop.foundation.get({ taskId });
window.novelLoop.foundation.cancel({ taskId });
window.novelLoop.foundation.read({ projectKey });
```

The renderer cannot access Node.js, Electron, `ipcRenderer`, the filesystem,
shell commands, environment variables, Codex authentication data, raw Codex
JSONL, absolute project paths, Story State, or generic IPC methods. Renderer
objects use opaque project keys and bounded location labels.

Every IPC request and response is validated with Zod in Electron main. The main
window uses context isolation, Chromium sandboxing, disabled Node integration,
web security, denied permission requests, blocked popups, and restricted
navigation.

## Project Library Behavior

The first project creation asks the author to choose a library parent
directory through an Electron native directory dialog. Electron main stores
that choice as the default for later projects. Selecting the alternate
location option affects only the current project and does not replace the
saved default.

Native dialogs and Electron main own all real filesystem paths. The renderer
never constructs, submits, or receives an absolute path. Opening an existing
project validates it before it is added to the recent list.

Removing a recent project changes only the application registry. It does not
delete, move, or modify project files. Creating a project initializes the
standard local skeleton from the supplied brief and performs no Codex call.

The project overview reports the latest committed chapter, project health,
Story Foundation availability, and global planning availability. It can open
the Story Foundation workflow, but remains read-only for project planning and
chapter state.

## Story Foundation Workflow

Story Foundation generation requires a locally ready and logged-in Codex
installation. From an incomplete project, choose `准备生成故事基础`, review the
confirmation, and select `开始生成`. No generation starts before that explicit
confirmation.

Generation runs as a background task and can take several minutes. The author
sees four document-generation stages, with preparation and finalization status:
story core, genre boundaries, reader expectations, and writing style. A stop
request is cooperative: it takes effect after the current Codex step finishes.
Failed or cancelled incomplete generation can be retried from the workflow.

When complete, the desktop provides a read-only review of exactly four strategy
documents: Story Bible, Genre Contract, Reader Promise, and Style Guide.
Completion does not expose planning, chapter, or state-commit actions. Story
Foundation generation and review do not modify formal Story State, the chapter
queue, committed chapters, snapshots, diffs, or canon-patch artifacts.

## Development

From the repository root:

```bash
corepack pnpm install
corepack pnpm desktop:dev
```

Build and verify the desktop package:

```bash
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop verify
```

Run the Electron security smoke after building:

```bash
corepack pnpm --dir apps/desktop test:e2e
```

The normal smoke reports a skip when the host cannot launch Electron securely.
The release gate is intentionally non-skippable:

```bash
corepack pnpm --dir apps/desktop verify:release
```

`verify:release` fails when a usable Chromium sandbox is unavailable. Run it in
a sandbox-capable packaging or CI environment before accepting a distributable
desktop build.

## Ubuntu 24.04 Sandbox Requirement

Electron must start with a working Chromium sandbox. Novel Loop does not use
`--no-sandbox` or `--disable-setuid-sandbox`.

On Linux, the Electron smoke requires either:

- a correctly installed root-owned SUID `chrome-sandbox` helper with mode
  `4755`; or
- a host policy that permits Chromium's unprivileged user-namespace sandbox.

Ubuntu hosts with restricted unprivileged user namespaces and an unprivileged
Electron helper cannot launch the development binary securely. In that case,
the smoke test reports a skip with the sandbox reason. Production packaging
must install or declare an appropriate sandbox policy before the application is
considered distributable.

Useful read-only diagnostics:

```bash
sysctl kernel.unprivileged_userns_clone
sysctl kernel.apparmor_restrict_unprivileged_userns
stat -c '%U %a %n' node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Do not work around a failed sandbox check by adding insecure Electron flags.

## Manual Ubuntu Workflow

From the repository root:

```bash
corepack pnpm desktop:dev
```

Then verify the author workflow:

1. Enter the Project Library after the readiness check.
2. Create a project and choose a default parent directory when prompted.
3. Open an incomplete project and select `准备生成故事基础`.
4. Confirm no generation starts before `开始生成`, then verify the four-stage
   progress wording and the statement that stopping takes effect after the
   current Codex step.
5. If local Codex is ready and quota is available, complete generation and
   review Story Bible, Genre Contract, Reader Promise, and Style Guide.
6. Return to the overview and confirm Story Foundation is ready while the
   latest committed chapter remains unchanged.

The local Electron smoke verifies the built desktop application, preload
boundary, and Chromium security controls without calling Codex or changing a
project. A manual run without a ready local Codex can verify confirmation,
progress wording, and navigation only; it cannot verify a real completion. Use
a disposable project for an intentional real-Codex author smoke. Do not use the
manual smoke to claim a Codex completion that was not run.

Run the required real Electron smoke separately:

```bash
corepack pnpm --dir apps/desktop test:e2e:required
```

## Current Scope

- Secure Electron main, preload, and renderer build separation.
- Strict CSP, permission denial, popup denial, and navigation restriction.
- Schema-validated `SystemReadiness` contract.
- Schema-validated named Project Library contract.
- Native default-library and existing-project directory selection.
- Local project creation from author brief fields without Codex.
- Recent project persistence, validation, reopening, and registry-only removal.
- Read-only project overview.
- Local-Codex Story Foundation generation as a cancellable background task.
- Read-only review of Story Bible, Genre Contract, Reader Promise, and Style
  Guide.
- Story State, chapter queue, planning, and chapter commits remain unavailable
  from the desktop Story Foundation workflow.
- Read-only mapping to the existing Codex execution boundary for readiness.
- First-launch states for ready, missing, logged out, warning, and unavailable.
- Unit tests for window policy, navigation, IPC, preload, engine mapping, and UI.
- Playwright Electron security smoke when the host sandbox is usable.
