# Novel Loop Desktop

Novel Loop Desktop is the Electron foundation for the local-first Novel Loop
authoring product. The current Phase A milestone contains a secure desktop
shell, a Chinese-first readiness flow, a local Project Library, generated Story
Foundation and global-planning review, and an author-controlled first-chapter
workflow through explicit draft adoption and reviewed local chapter submission.
The controlled-submission flow below has passed integration verification with
disposable projects and deterministic fake Codex. This is not a packaged-release
or real-Codex generation-quality acceptance claim.

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

The editor also provides `保存草稿` and Ctrl+S for immediate local saving.
Manual save and autosave share the same serialized save queue. The save
button remains available even after autosave; clicking it acknowledges
an already-saved version without creating a duplicate author revision. While
a write or a protected adoption/recovery operation is in progress it is disabled.
After adoption,
the workspace switches to prose preview and shows `修订已采用，尚未正式提交。`;
adoption is disabled until another revision is available. The preview hides
only the engine's leading `Chapter NNN Draft` placeholder, without changing
the editable Markdown or the source file.

The original Phase A boundary stops at the adopted author draft. The
controlled-submission extension adds the separate, explicitly confirmed flow
below; saving or adopting still never commits a chapter.

## Controlled Submission

Three statuses have different meanings:

- **已保存**: the local working copy is persisted, but not adopted or committed.
- **已采用**: an author revision is selected; the original `draft_v1.md`, formal
  Story State, and chapter queue are unchanged.
- **已正式提交**: the reviewed version has been explicitly confirmed and written
  as the canonical chapter, with a recorded Story State and queue transition.

After adopting the intended prose, select `检查并提交`, then `开始检查`.
If diagnostics fail, `让 AI 根据检查结果修订` opens an isolated candidate
workflow. Only `生成修订候选` starts Codex. Compare source and candidate,
review the AI's unverified explanations, and explicitly adopt or reject the
whole candidate. Adoption changes the authored version only and requires a
fresh check; it never commits or invokes a provider. Candidates and provenance
remain in `diagnostic_revisions/revision_vN/`. Stale sources, pending editor
changes, tampered evidence, and ambiguous interrupted adoptions block adoption.
Cancellation does not publish late provider results. Generation uses the existing
read-only Codex boundary and sends checked prose/context to that service.
Entering the screen does not start Codex. Checking uses the existing read-only
local Codex boundary to produce isolated diagnostics and proposed story changes;
it does not rewrite the prose or commit those changes. Review the displayed
version, every story change, and warnings. Check `我已审阅正文版本和全部故事变化`,
select `正式提交第 N 章`, and then separately select `确认正式提交` in the dialog.
Confirmation makes no provider calls. After verified success, `创作下一章`
returns to the existing planning flow; it does not automatically generate prose.

Canonical output remains under the selected project's `chapters/chapter_NNN/`:
`final.md` contains the exact reviewed prose and `canon_patch.json` the reviewed
patch. The commit report, versioned commit journal, approval in
`submission_previews/preview_vN/`, and before/after snapshots under `snapshots/`
record the operation. Generated originals and adopted revisions are retained.
Formal Story State and the corresponding chapter queue advance once.

Unadopted edits block submission, including a saved working copy from another
window. Changing an adopted version or relevant project inputs invalidates the
old preview: review and confirm a new check instead. Diagnostics failure or
quota exhaustion leaves the prose and canonical state unchanged; return to
human editing or explicitly check again after the cause is resolved. Stopping a
check takes effect at the next safe boundary. No automatic revision loop runs.
The UI does not restart a failed task automatically. The existing provider may
make one bounded internal retry for quota-denied output; a new user task is not
started by terminal polling or reopening the review.

Restart reads persisted evidence without automatically checking or confirming.
A restored preview requires fresh human approval. If a confirmation response
is lost, inspect the persisted completion status rather than repeating it.
An incomplete journal means **提交中断，需要检查**: preserve the project,
snapshots and journal for inspection. Journal handling detects and blocks
incomplete commits; it does not automatically roll back, repair, or resume them.
Do not delete journal evidence to force a retry.
A preview file alone does not authorize submission: its durable ready task and
successful check-run evidence must agree. Interrupted publication is blocked
and remains visible to audit; reading or restarting never repairs those records.

### Targeted Integration Gate

After backend review, route clearance, and a fresh `corepack pnpm desktop:build`,
run the bounded Electron submission test separately from the full suites:

```bash
NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE=1 corepack pnpm --dir apps/desktop exec playwright test tests/e2e/electron-submission.test.ts --workers=1
```

The test seeds a disposable project using the existing root fake Codex helper
and built engine in a child Node ESM process. It uses a separate Electron
user-data registry, never a real novel or real Codex. Screenshots are written
to ignored `apps/desktop/test-results/` at 1440x900 and 1024x768. A required run
fails when secure sandbox launch is unavailable. Test discovery or typechecking
alone does not satisfy this gate. Full root and desktop suites run sequentially
under the integration controller; do not start duplicate concurrent suites.

The bounded suite also exercises diagnostics hard failure, quota exhaustion,
autosaved-but-unadopted edits, stale previews after adoption, and cancellation
while a temporary fake is held. Partial-write fault injection and journal retry
barriers belong to the engine integration tests; they are not simulated by
damaging a running Electron project.

## Development

From the repository root:

```bash
corepack pnpm install
corepack pnpm desktop:dev
```

The same commands run in Windows PowerShell. On Windows, the desktop can use a
native `codex.exe` on `PATH` or the JavaScript entry point of a global
`@openai/codex` npm installation. It invokes neither `.cmd` files nor a shell
for provider requests. The project remains a source-run application; this
repository does not produce a Windows installer.

Windows cannot flush directory handles through Node.js. Temporary draft and
lease files are still synced before publication, while project journals and
recovery checks guard interrupted operations. Back up important project and
application-data directories because crash-time directory durability differs
from Linux.

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

## Incomplete Codex Installation

If startup reports `Codex 安装不完整`, the Codex launcher was found but its
platform executable package is missing. Check `codex --version` in a terminal.
A `Missing optional dependency @openai/codex-...` error requires repairing the
Codex installation, not changing the novel project or logging in again.

For npm installations, reinstall the intended Codex version with
`--include=optional`. On slow connections, allow enough download time with
`--fetch-timeout=600000`. Do not run multiple installs against the same prefix
at once. npm can report success even if an optional download failed, so verify
`codex --version` and `codex login status` afterwards, then select
`修复后重新检查` in Novel Loop.

The application displays fixed recovery guidance without forwarding the
launcher stack trace, local paths, or authentication data to the renderer.

## Codex Model Requires a Newer CLI

An installed and logged-in Codex can still be too old for the configured model.
If generation reports `本地 Codex 版本过旧`, upgrade the CLI using its existing
installation method, verify `codex --version` and `codex login status`, then
continue the interrupted task. Do not reset the novel or remove adopted edits.
Novel Loop recognizes redacted `error` / `turn.failed` JSONL events, reports an
upgrade requirement separately from a missing installation, and does not
automatically repeat or JSON-repair a request blocked by that requirement.

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
- Explicit adopted-text diagnostics, review of all proposed story changes,
  one-time local confirmation, audited snapshots/journal, and next-chapter
  navigation. Only formal confirmation advances canonical Story State.
- Read-only mapping to the existing Codex execution boundary for readiness.
- First-launch states for ready, missing, logged out, warning, and unavailable.
- Unit tests for window policy, navigation, IPC, preload, engine mapping, and UI.
- Playwright Electron security smoke when the host sandbox is usable.

## Unsupported In Phase A

- Story Foundation editing and global-planning editing.
- Automatic revision loops, rollback, and archive operations. Controlled
  diagnostics, review and local commit are supported as described above;
  real-provider generation quality and packaged distribution remain separate gates.
- DeepSeek, OpenAI API integration, Web UI/SaaS operation, and cloud accounts or
  billing.
- CodexAgentConnector, workspace-write, renderer filesystem or shell access,
  and renderer access to Codex authentication or raw JSONL.
- Historical recommit, stale regeneration, and conflict auto-repair.
