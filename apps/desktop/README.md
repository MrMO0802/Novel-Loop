# Novel Loop Desktop

Novel Loop Desktop is the production Electron foundation for the local-first
Novel Loop authoring product. The current milestone contains a secure desktop
shell, a Chinese-first first-launch readiness flow, and a usable local Project
Library.

Authors can create a new Novel Loop project from a short brief, open a valid
existing project, return to recent projects, and inspect a read-only project
overview. This milestone does not generate Story Bible or planning artifacts,
write chapters, change Story State or the chapter queue, commit chapters, roll
back snapshots, or restore archives.

## Architecture Boundary

```text
React renderer
  -> typed contextBridge API
  -> validated Electron IPC
  -> Electron main application service
  -> Novel Loop Engine desktop adapter
```

The renderer receives named system and project methods:

```ts
window.novelLoop.system.getReadiness();
window.novelLoop.projects.list();
window.novelLoop.projects.chooseDefaultLibrary();
window.novelLoop.projects.create(request);
window.novelLoop.projects.openExisting();
window.novelLoop.projects.open(projectKey);
window.novelLoop.projects.remove(projectKey);
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

The project overview is currently read-only. It reports the latest committed
chapter, project health, Story Bible availability, and global planning
availability. `准备生成故事基础` is intentionally unavailable until the next
workflow stage; Story Bible and planning generation are not implemented here.

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
3. Confirm the read-only project overview, then return to the library.
4. Remove the project from recent projects and confirm its files remain.
5. Open the same project through the native directory dialog.
6. Restart the application and confirm the recent entry persists.

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
- Read-only mapping to the existing Codex execution boundary for readiness.
- First-launch states for ready, missing, logged out, warning, and unavailable.
- Unit tests for window policy, navigation, IPC, preload, engine mapping, and UI.
- Playwright Electron security smoke when the host sandbox is usable.
