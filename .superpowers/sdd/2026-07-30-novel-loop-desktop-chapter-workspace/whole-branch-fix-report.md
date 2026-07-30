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

## Remaining Findings

The following findings remain open and are intentionally outside this focused
C1 commit:

- I1: shared project operation lease and queue CAS/revalidation;
- I2: canonical queue history and desktop lifecycle allowlist;
- I3: mission narrative-debt reference integrity;
- I4: scene character grounding;
- I5: scene-card workload limits;
- I6: partial candidate bounds and exact ranking inputs;
- M1: bounded author-facing review-unavailable classification.
