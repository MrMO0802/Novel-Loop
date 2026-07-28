# Novel Loop Desktop Story Foundation Final Fix Report

Date: 2026-07-28

Base HEAD: `6bd98b9f81e3d276c4e414424d902164162a862e`

Scope: the five Important final-review findings and the explicitly scoped
low-risk items. No Story State, queue, canonical chapter implementation,
generic IPC, renderer filesystem/shell access, real Codex invocation, desktop
force control, or Electron security policy was added or changed.

## Result

All five findings are fixed with focused RED/GREEN coverage. The full engine,
desktop, production build, type-check, and required Electron smoke gates pass.

## Finding 1: Atomic Complete-Foundation Protection

### RED

Focused regressions were added before implementation:

- a fresh project lock was ignored and generation proceeded;
- an old lock was not recovered;
- two independent `ProjectFoundationService` and
  `EngineFoundationGateway` instances against one project both completed
  successfully, proving the process-local ownership check did not prevent a
  cross-instance overwrite race.

Commands used while RED:

```text
corepack pnpm vitest run tests/integration/buildBibleLifecycle.test.ts
corepack pnpm --dir apps/desktop exec vitest run tests/main/foundationStateProtection.test.ts
```

Observed failures: the fresh-lock promise resolved, the stale lock remained,
and both independent services reported `succeeded`.

### GREEN

`buildBible` now holds a project-scoped filesystem lock from before the brief,
cache, and complete-output existence checks through all provider calls,
strategy writes, finalization, and run completion.

Lock semantics:

- lock path: `<project>/.novel-loop-build-bible.lock`;
- atomic acquisition: `mkdir` with one owner per project;
- owner metadata: random token, PID, and acquisition timestamp;
- active heartbeat: directory mtime refreshed every 30 seconds;
- stale threshold: 10 minutes;
- crash recovery: stale lock is atomically renamed to a unique quarantine
  path and removed, with four bounded acquisition/recovery attempts;
- normal release: verifies the owner token, atomically renames the lock to a
  unique release path, then removes it;
- failed release cleanup cannot replace the build result; the canonical lock
  remains recoverable through the stale path;
- a crash after directory creation or during generation cannot create a
  permanent lock dead-end because the unrefreshed lock becomes stale;
- fresh contention throws `BUILD_BIBLE_LOCKED`, mapped by desktop to
  retryable `generation_busy`;
- explicit engine/CLI `force` and `forceRegenerate` behavior is preserved,
  but forced builds are serialized by the same lock;
- desktop still does not expose force.

GREEN coverage:

- fresh lock rejects without strategy output;
- 11-minute stale lock recovers and is released;
- two independent service/gateway instances produce exactly one success and
  one retryable `generation_busy`, followed by a readable complete set;
- existing retry and force-regeneration coverage remains green.

## Finding 2: Stop During Final Codex Call

### RED

A service test started the fourth (`style_guide`) call, requested stop while
that call was in flight, then resolved the gateway successfully.

Observed RED result: `ProjectFoundationService` changed the successful return
to `cancelled`.

### GREEN

A successful gateway return now always calls `finishSucceeded`. The service
uses `cancelled` only when the gateway throws `BUILD_BIBLE_CANCELLED`.

The regression now verifies `succeeded`, `completed`, `canRetry: false`, and
no error after a stop request during the final in-flight call.

## Finding 3: Provider Error Classifications

### RED

Real `EngineFoundationGateway` tests used representative fake-Codex process
behavior:

- missing binary;
- nonzero exit with "Not logged in. Run codex login";
- nonzero exit with a usage/rate-limit message;
- nonzero generic unavailable/connection-refused stderr;
- successful exit with no final output file.

Observed RED results:

- gateway errors had no structured `classification`;
- binary missing and output missing mapped to `unexpected`;
- the service-only login/usage tests used synthetic codes the provider did
  not emit.

### GREEN

`ProviderError` preserves its existing provider, code, recoverability, and CLI
compatibility while adding a structural classification:

- `unavailable`;
- `login_required`;
- `usage_limit`;
- `invalid_output`.

`CODEX_BINARY_NOT_FOUND`, output-missing, schema/JSON failures, and generic
execution failures now receive classifications. Execution stderr detection
orders usage and login checks before the generic unavailable fallback, so the
specific categories cannot be shadowed by `CODEX_EXEC_FAILED`.

The desktop service consumes the structural classification first, retains
ordered code fallbacks, and never exposes stderr, tokens, auth-file names, or
private paths. Existing Codex-boundary redaction remains active; its auth-file
token pass was made linear so a 2 MiB output cannot trigger quadratic
processing.

## Finding 4: `already_complete` Recovery

### RED

Renderer tests covered:

- external completion while the overview still said incomplete;
- leaving a running generation, allowing background completion, then
  re-entering from stale overview data;
- leaving the generation route while the already-complete refresh was still
  pending.

Observed RED results: the first two cases stayed on the non-retryable failure
screen without refreshing, and the third did not begin the guarded refresh.

### GREEN

`already_complete` now follows the same project refresh path as a successful
task. The renderer enters review only when `projects.open` returns an
opened/created project whose refreshed `storyBibleAvailable` is true.

The existing mounted flag and monotonic request token guard both state updates
and navigation. The stale-response test confirms a refresh resolved after
leaving cannot navigate back to Foundation Review.

## Finding 5: Bounded Foundation Reads and Generated Output

### RED

Tests added:

- an existing required file larger than 2 MiB;
- a required path that is a directory rather than a regular file;
- a fake Codex whose fourth generated Markdown document exceeds 2 MiB;
- a real desktop gateway/service read of an oversized complete-looking set.

Observed RED results:

- the reader consumed content before rejection;
- non-regular input surfaced a filesystem error;
- the desktop gateway surfaced a raw Zod error instead of the engine error;
- the oversized fake-provider case exposed quadratic auth-path redaction and
  did not reach a bounded rejection.

### GREEN

Before reading any content, `readDesktopStoryBible` now `lstat`s all four
required paths and:

- returns unavailable if any file is absent;
- rejects non-regular files;
- rejects any file over 2 MiB;
- enforces an 8 MiB aggregate maximum;
- rechecks UTF-8 byte counts after reading to cover content changes between
  metadata and content reads.

Invalid content throws `DESKTOP_STORY_BIBLE_INVALID_OUTPUT`, which maps to
retryable desktop `invalid_output`.

`buildBible` checks UTF-8 bytes immediately after each provider result and
before writing prompt-response or strategy artifacts. An oversized fourth
document therefore leaves only the first three strategy files. A retry with
`resumeIncomplete: true` completes successfully; no unreadable four-file set
is declared complete. A valid prior complete desktop foundation remains
protected by the preflight check and project lock.

## Scoped Low-Risk Items

- Added `overflow-wrap: anywhere` to generated review headings.
- Confirmation now states that generation usually takes several minutes and
  still states that Story State is not written.
- Active generation renders an accessible ordered seven-stage list using
  `completedStages`, marks the current item with `aria-current="step"`, and
  renders elapsed minutes from `startedAt` with `role="timer"`.
- Existing reduced-motion handling remains unchanged and applies to both
  progress spinners.
- The existing test named
  `preserves canonical files through the real desktop service and gateway`
  keeps that exact name and now seeds and SHA-256 checks existing
  `final.md`, `canon_patch.json`, and `commit_report.json` files.
- The asynchronous heading-focus test now waits for the existing focus effect,
  preserving the same positive accessibility assertion under parallel load.
- `RUN_COMPLETED`-on-cancel and duplicated `ProjectKeySchema` remain deferred
  and untouched.

## Focused Verification

Final engine-focused command:

```text
corepack pnpm vitest run tests/integration/buildBibleLifecycle.test.ts tests/providers/codexTextProvider.test.ts tests/unit/desktopStoryBible.test.ts
```

Result: PASS, 3 files, 18 tests, 12.86 seconds.

Final desktop-focused command:

```text
corepack pnpm --dir apps/desktop exec vitest run tests/main/projectFoundationService.test.ts tests/main/foundationStateProtection.test.ts tests/renderer/foundationGeneration.test.tsx tests/renderer/foundationReview.test.tsx tests/renderer/App.test.tsx tests/renderer/projectLibrary.test.tsx
```

Result: PASS, 6 files, 93 tests, 14.70 seconds.

The UI low-risk RED run had two expected generation failures (missing timing
copy and stage list) and one expected review CSS failure (missing heading
wrap). The corresponding focused GREEN run passed 20/20 generation/review
tests before the final combined focused run above.

## Full Verification

Commands and exact final results:

```text
corepack pnpm install --frozen-lockfile
```

PASS, lockfile current and dependencies already up to date, 1.3 seconds.

```text
corepack pnpm build
```

PASS, root TypeScript build, 17.177 seconds.

```text
corepack pnpm test
```

PASS, 175 files and 409 tests, 254.04 seconds.

```text
corepack pnpm --dir apps/desktop check
```

PASS, node/web/e2e TypeScript checks, 13.545 seconds.

```text
corepack pnpm --dir apps/desktop test
```

Final result: PASS, 18 files and 196 tests, 13.66 seconds.

The first full desktop attempt found one stale copy expectation and one
parallel timing failure in the existing heading-focus assertion. After the
copy assertion was updated, the focus test passed alone but repeated under the
full parallel suite. The test now uses `waitFor` for the existing `useEffect`
focus behavior. The next complete desktop run passed as reported above; no
production focus code changed.

```text
corepack pnpm --dir apps/desktop build
```

PASS, Electron main/preload/renderer production bundles, 2.687 seconds.

```text
corepack pnpm --dir apps/desktop test:e2e:required
```

PASS, 1 Playwright Electron smoke test, 2.6 seconds. The smoke test verified
the narrow preload API and blocked renderer privilege escape.

```text
git diff --check
```

PASS before report authoring; repeated after report authoring and before
commit.

No real Codex or API key was used.

## Changed Files

Production:

- `src/app/projectBuildLock.ts`
- `src/app/buildBible.ts`
- `src/app/codexBoundary.ts`
- `src/desktop/storyBible.ts`
- `src/providers/codexTextProvider.ts`
- `apps/desktop/src/main/foundation/ProjectFoundationService.ts`
- `apps/desktop/src/shared/foundationContract.ts`
- `apps/desktop/src/renderer/src/features/foundation/FoundationGenerationView.tsx`
- `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- `apps/desktop/src/renderer/src/styles/foundation.css`

Tests:

- `tests/integration/buildBibleLifecycle.test.ts`
- `tests/unit/desktopStoryBible.test.ts`
- `apps/desktop/tests/main/projectFoundationService.test.ts`
- `apps/desktop/tests/main/foundationStateProtection.test.ts`
- `apps/desktop/tests/renderer/App.test.tsx`
- `apps/desktop/tests/renderer/foundationGeneration.test.tsx`
- `apps/desktop/tests/renderer/foundationReview.test.tsx`
- `apps/desktop/tests/renderer/projectLibrary.test.tsx`

Report:

- `.superpowers/sdd/2026-07-28-novel-loop-desktop-story-bible/final-fix-report.md`

## Self-Review

The final diff was reviewed against each finding and the global constraints.

- Lock scope includes the existence check, all long provider calls, writes,
  and completion.
- Contention is structurally author-recoverable and cannot expose paths.
- Successful gateway completion cannot be reclassified by a late stop flag.
- Provider category precedence is structural, with specific login/usage
  detection ahead of generic execution fallback.
- Already-complete refresh and navigation are guarded against unmount and
  stale responses.
- Filesystem type and size checks occur before content reads.
- Generated over-limit output is rejected before strategy write.
- Renderer production code imports no filesystem, shell, or Codex execution
  API and receives no paths, run IDs, auth data, or raw output.
- Electron preload, navigation, session, sandbox, and window security code is
  unchanged; required Electron smoke coverage passes.
- Story State, queue, snapshots, diffs, and canonical chapter implementation
  are unchanged; real gateway tests hash-check protected canonical files.
- No force control was added to desktop.

No Critical or Important issue remained after self-review.

## Residual Concern

Crash recovery intentionally waits until the 10-minute stale threshold before
another process may take over; contention does not auto-wait or auto-retry in
the desktop task. This bounds stale-lock recovery and avoids treating a normal
long Codex call as abandoned, but an author may need to retry after that
interval following a hard process crash. Unique `.stale-*` or `.released-*`
cleanup paths are outside the canonical lock name, so a cleanup failure cannot
permanently block acquisition.
