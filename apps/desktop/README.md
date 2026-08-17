# Novel Loop Desktop

Novel Loop Desktop is the Electron foundation for the local-first Novel Loop
authoring product. The current Phase A milestone contains a secure desktop
shell, a Chinese-first readiness flow, a local Project Library, generated Story
Foundation and global-planning review, and an author-controlled first-chapter
workflow through explicit draft adoption.

Authors can compare chapter directions, select a non-recommended option, edit
the chapter mission and selected direction, request bounded local-Codex
adjustments, compare candidates, repair the scene-participant roster, generate
an initial draft, edit it with local autosave and recovery, and explicitly adopt
an author revision. Story Foundation and global planning are review-only in
this milestone; this document does not claim they can be edited.

## Architecture Boundary

```text
React renderer
  -> typed contextBridge API
  -> validated Electron IPC
  -> Electron main application service
  -> Novel Loop Engine desktop adapter
```

The renderer receives named, typed methods for system readiness, project
library, Story Foundation, global planning, and bounded chapter authoring. It
does not receive a generic IPC escape hatch.

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

Chapter methods use opaque project, review, option, and revision tokens. They
support review, direction selection, working-copy save/discard, bounded
adjustment, comparison, and explicit adoption without exposing internal paths,
hashes, run IDs, schema names, or raw provider output to the renderer.

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
Story Foundation availability, and global-planning availability. Generated
Story Foundation and global planning can be reviewed and used as chapter
inputs, but remain read-only. Chapter working copies and adopted author
revisions do not commit Story State or advance the chapter queue.

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
documents: Story Bible, Genre Contract, Reader Promise, and Style Guide. Story
Foundation generation and review do not modify formal Story State, the chapter
queue, committed chapters, snapshots, diffs, or canon-patch artifacts. The
author may then confirm it as input to generated global planning; direct Story
Foundation editing is not part of Phase A.

## Chapter Author-Control Workflow

Phase A uses four distinct states so generated material is never confused with
an author's accepted version:

1. **Generated source** - the mission, plan, or `draft_v1.md` produced by the
   engine. This source remains unchanged for reproducibility.
2. **Working copy** - the author's unadopted local edits. Chapter prose is
   autosaved under Electron application data; no user-specific path is shown in
   the UI or documented as a stable storage API.
3. **Candidate / comparison** - a saved direct edit or bounded AI adjustment
   displayed beside its source. Saving does not adopt it.
4. **Adopted author draft** - the version accepted through an explicit adopt
   action. Adopted prose is stored as a versioned file under the chapter's
   `author_revisions/` history; generated `draft_v1.md` remains intact.

The chapter review presents three titled directions and marks the AI
recommendation without forcing it. Selecting another direction, adopting a
mission or plan edit, or adopting an AI-adjusted candidate first shows the
downstream content that must be regenerated. AI adjustment is bounded to the
current mission or direction and always returns a candidate; it cannot silently
replace the active version.

Mission editing keeps character-reference checks intact. If no valid scene
participant remains, drafting stops before scene-card generation. The author
can reselect a known character, add a provisional participant with a name and
role, or request a bounded participant repair. Empty, partial, duplicate, or
unknown references are still rejected by the existing validation boundary.

Draft editing uses a working copy separate from the generated source. Changes
are autosaved in Electron application data and can be explicitly continued or
discarded after an application restart. The author may compare the edited text
with the generated source before adoption. Adoption creates a versioned author
revision; it does not rewrite `draft_v1.md`, formalize a chapter, or update
Story State.

Phase A stops at the adopted author draft. It does not run diagnostics, create
revision-loop candidates, write canonical `final.md` or `canon_patch.json`,
preview or approve Story State mutations, create commit snapshots, commit a
chapter, or advance `latestCommittedChapter`.

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

### Ubuntu watcher limit

If `desktop:dev` exits with `ENOSPC: System limit for number of file watchers
reached`, increase the host inotify watcher limit. A temporary setting until
the next reboot is:

```bash
sudo sysctl fs.inotify.max_user_watches=524288
sudo sysctl fs.inotify.max_user_instances=1024
```

For a persistent Ubuntu setting:

```bash
printf 'fs.inotify.max_user_watches=524288\nfs.inotify.max_user_instances=1024\n' \
  | sudo tee /etc/sysctl.d/99-novel-loop-watchers.conf
sudo sysctl --system
```

This changes host development limits only. It does not repair or modify Novel
Loop projects. Close unused Vite/Electron development processes before raising
the limit, because each process consumes watchers.

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
6. Generate and review global planning without expecting an editing control.
7. Prepare chapter one, compare all three named directions, and deliberately
   select a non-recommended direction.
8. Edit the selected direction, compare it with its source, inspect the
   downstream invalidation warning, and explicitly adopt it.
9. Edit the mission. Remove all participants and confirm drafting is blocked;
   then add or repair a valid participant and explicitly adopt the mission.
10. Generate the initial draft, edit it, wait for autosave, restart Electron,
    explicitly continue the recovered working copy, compare, and adopt it.
11. After the generated draft reaches `draft_ready`, confirm author editing,
    recovery, and adoption leave `draft_v1.md` and the chapter queue unchanged;
    confirm Story State and the latest committed chapter stayed unchanged across
    the complete Phase A workflow while a versioned author revision now exists.

The Electron suites verify the built application, preload boundary, Chromium
security controls, and author workflow with deterministic fake-Codex fixtures
and disposable project data. They do not call a real Codex provider or modify a
user project. A manual run without a ready local Codex can verify confirmation,
progress wording, editing controls, and navigation only; it cannot verify a real
generation completion. Use a disposable project for an intentional real-Codex
author smoke. Do not use the manual smoke to claim a Codex completion that was
not run.

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
- Project overview and generated Story Foundation/global-planning review.
- Local-Codex Story Foundation generation as a cancellable background task.
- Read-only review of Story Bible, Genre Contract, Reader Promise, and Style
  Guide.
- Read-only global outline, volume outline, story-line, and chapter-queue review.
- Three-way chapter-direction comparison and explicit non-default selection.
- Direct chapter-mission and selected-plan editing, bounded AI adjustment,
  source/candidate comparison, downstream invalidation disclosure, and explicit
  adoption.
- Participant repair without weakening scene character-reference validation.
- Generated draft editing through an Electron application-data working copy,
  autosave, restart recovery, comparison, discard, and versioned author
  adoption.
- Generated `draft_v1.md`, Story State, and `latestCommittedChapter` remain
  protected; after generation reaches `draft_ready`, editing, recovery, and
  adoption leave the chapter queue unchanged.
- Read-only mapping to the existing Codex execution boundary for readiness.
- First-launch states for ready, missing, logged out, warning, and unavailable.
- Unit tests for window policy, navigation, IPC, preload, engine mapping, and UI.
- Playwright Electron security smoke when the host sandbox is usable.

## Unsupported In Phase A

- Story Foundation editing and global-planning editing.
- Desktop diagnostics, full revision loop, canonical `final.md`, canon patch,
  state diff, human commit approval, snapshots, commit, rollback, and archive
  operations.
- DeepSeek, OpenAI API integration, Web UI/SaaS operation, and cloud accounts or
  billing.
- CodexAgentConnector, workspace-write, renderer filesystem or shell access,
  and renderer access to Codex authentication or raw JSONL.
- Historical recommit, stale regeneration, and conflict auto-repair.
