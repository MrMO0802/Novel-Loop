# Whole-Branch Fix Report

Date: 2026-07-30

Branch: `codex/desktop-chapter-workspace`

Review source: `whole-branch-review.md`

## C1: Internal Project Symlink Write Escape

Status: **CLOSED**

### Verification Of Finding

The finding was valid. The original `FileStore` and `AtomicWriter` resolved
paths lexically but followed symlinked project descendants. Desktop chapter
generation also did not preflight `chapters`, the target chapter directory,
`scenes`, `runs`, or `codex/runs` before invoking Codex.

### RED Evidence

The first valid adversarial run of:

```bash
corepack pnpm exec vitest run \
  tests/integration/desktopChapterSymlinkBoundary.test.ts \
  --reporter=verbose
```

failed all five cases:

- symlinked `chapters` resolved successfully and planning completed;
- symlinked `chapter_001` resolved successfully and planning completed;
- symlinked `runs` resolved successfully and planning completed;
- symlinked `codex/runs` resolved successfully and planning completed;
- symlinked `scenes` was not classified or rejected by a project path boundary.

### Production Fix

- Added `ProjectPathGuard` to require lexical containment, reject symlinked
  descendants, and verify canonical containment for every existing ancestor.
- Added `FileStore.forProject()` so project reads, writes, appends, directory
  creation, existence checks, and directory listing use the same guard.
- Added repeated guard checks in `AtomicWriter` before directory creation,
  temporary-file creation, and final rename.
- Added Desktop chapter preflight for `chapters`, target chapter, `scenes`,
  `runs`, and `codex/runs` before any Codex call or queue transition.
- Passed the guarded project store through planning, drafting, run logging, and
  prompt-output provenance writes.
- Guarded Codex run artifacts and final/parsed output while keeping installed
  prompt and output-schema resources on a separate read-only store.

### GREEN Evidence

```text
corepack pnpm build
PASS

corepack pnpm exec vitest run \
  tests/integration/desktopChapterSymlinkBoundary.test.ts \
  tests/e2e/codexBoundary.test.ts \
  tests/unit/storage/fileInfrastructure.test.ts \
  --reporter=verbose
PASS: 3 files, 18 tests

git diff --check
PASS
```

The adversarial tests assert:

- the external directory remains unchanged;
- `state/story_state.json` remains byte-for-byte unchanged;
- `planning/chapter_queue.json` remains byte-for-byte unchanged;
- Codex is not invoked after the unsafe path is installed.

## I2: Canonical Queue History And Desktop Lifecycle Contract

Status: **CLOSED**

### Verification Of Finding

The finding was valid. The engine consistency validator accepted
`recommitted`, but did not require every canonical chapter from 1 through
`latestCommittedChapter`. The desktop maintained a separate validator that
rejected `recommitted`, and it accepted target statuses and failed stages from
diagnostics, review, repair, and commit workflows. Queue stage updates did not
revalidate their expected source status or stage.

### RED Evidence

The initial focused run failed because:

- a missing canonical Chapter 1 produced no consistency issue;
- a queue item in `diagnosing` was changed back to `planning`;
- valid `recommitted` history was rejected by desktop inspection;
- all tested later-workflow target statuses were accepted;
- `failed/diagnostics` passed both inspection and transition checks.

The stage-specific adversarial run reported:

```text
FAIL: 2 tests
- rejects a failed desktop target whose queue stage belongs to diagnostics
- rejects a desktop queue transition from a failed later lifecycle stage
```

### Production Fix

- Centralized desktop queue/Story State consistency on
  `validateChapterQueueConsistency`.
- Required one continuous canonical queue history from Chapter 1 through
  `latestCommittedChapter`, accepting `committed` and `recommitted`.
- Preserved the next-chapter gap check in the centralized validator.
- Added an explicit desktop status/phase/current-stage matrix. Planning and
  drafting phases reject diagnostics, review, repair, commit, historical, and
  stale lifecycle states.
- Added expected status and stage guards to queue transitions. Desktop planning
  and drafting enable these guards; existing non-desktop callers retain their
  current behavior.
- Kept queue bytes unchanged when a guarded transition is rejected.

### GREEN Evidence

```text
corepack pnpm exec vitest run \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/e2e/chapterQueueLifecycle.test.ts \
  --reporter=dot
PASS: 2 files, 39 tests

corepack pnpm exec vitest run \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/e2e/idempotency.test.ts \
  --reporter=dot
PASS: 4 files, 8 tests
```

## M1: Bounded Review-Unavailable Classification

Status: **CLOSED**

### Verification Of Finding

The finding was valid. `ProjectChapterService.readPlan` and `readDraft`
converted every gateway, schema, and read failure to `project_unavailable`.

### RED Evidence

The focused service test expected `invalid_output` for an invalid plan review,
but received `project_unavailable`.

### Production Fix

- Extended plan and draft unavailable review contracts to exactly
  `not_ready`, `invalid_output`, and `project_unavailable`.
- Reused the bounded invalid-output classifier for gateway/schema failures.
- Classified a missing prerequisite as `not_ready` and an unavailable project
  as `project_unavailable`.
- Returned only the bounded reason; raw paths and internal error messages never
  enter the renderer response.

### GREEN Evidence

```text
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectChapterService.test.ts \
  --reporter=verbose
PASS: 1 file, 23 tests

corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/main/chapterStateProtection.test.ts \
  tests/renderer/chapterPlanningGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx \
  --reporter=dot
PASS: 6 files, 91 tests
```

## Remaining Findings

The following findings remain open and are intentionally outside this focused
C1/I2/M1 work:

- I1: shared project operation lease and queue CAS/revalidation;
- I3: mission narrative-debt reference integrity;
- I4: scene character grounding;
- I5: scene-card workload limits;
- I6: partial candidate bounds and exact ranking inputs.
