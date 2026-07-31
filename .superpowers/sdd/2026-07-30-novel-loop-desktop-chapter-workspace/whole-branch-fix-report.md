# Whole-Branch Fix Report

Date: 2026-07-31

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

### Residual Draft-Retry Regression

The I3/I4 verification exposed an I2 baseline regression that was reproducible
at commit `40e8033`: after scene-card generation failed before writing
`scene_cards.json`, artifact inspection correctly fell back to `plan_ready`,
while the queue correctly retained `failed/scene_cards`. The desktop matrix
rejected that safe retry combination.

The existing `chapterStateProtection` recovery test served as RED. The fix adds
only the explicit `plan_ready + failed + scene_cards` recovery combination.
It does not admit diagnostics, review, repair, commit, historical, or stale
statuses or stages.

```text
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterStateProtection.test.ts \
  -t "preserves Story State bytes through drafting invalid output recovery" \
  --reporter=verbose
PASS: 1 test

corepack pnpm exec vitest run \
  tests/unit/desktopChapterWorkspace.test.ts \
  --reporter=dot
PASS: 1 file, 35 tests

corepack pnpm exec vitest run \
  tests/e2e/chapterQueueLifecycle.test.ts \
  -t "rejects a desktop queue transition" \
  --reporter=verbose
PASS: 2 tests
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

## I3: Mission Narrative-Debt Reference Integrity

Status: **CLOSED**

### Verification Of Finding

The finding was valid. `ChapterMissionSchema` validated the shape of
`debtsToPayOrAdvance`, but planning did not require each ID to be unique,
present in the current Story State, and in an advanceable status. The desktop
author review also replaced an impossible empty/invalid reference set with
the claim that an existing suspense thread would be advanced.

### RED Evidence

The initial narrative-reference integration run failed all three debt cases:

- an unknown debt ID produced a complete planning artifact set;
- a duplicate debt ID was accepted;
- a resolved-only debt ID was accepted.

The author-review unit test also failed because it received the
`推进一条既有悬念` fallback instead of bounded invalid-output handling.

### Production Fix

- Added a shared mission-debt validator against current Story State.
- Allowed only unique debt IDs whose status is `open`, `escalated`, or
  `partially_paid`.
- Rejected unknown, duplicate, resolved, paid, and cancelled references before
  writing `mission.json`.
- Preserved Story State and prevented candidate, ranking, and selected-plan
  fan-out after rejection.
- Recorded `CHAPTER_MISSION_INVALID_PROVIDER_OUTPUT` with a bounded queue
  failure reason that does not expose IDs, paths, or raw provider output.
- Removed the impossible author-facing suspense fallback.

## I4: Scene Character Grounding

Status: **CLOSED**

### Verification Of Finding

The finding was valid. The slim scene-card prompt omitted canonical character
context, the normalizer supplied a hard-coded `char_lincheng` fallback, and
scene cards were not checked against Story State before draft fan-out.

### RED Evidence

The initial narrative-reference integration run failed all four scene cases:

- the prompt did not contain the non-default canonical character map;
- an unknown character ID was accepted;
- a display name was accepted in place of an ID;
- an empty character list was accepted through normalization.

Together with the I3 cases, the first focused run reported seven failed tests.

### Production Fix

- Added bounded committed and mission-declared character ID/name context plus
  mission character references to the slim scene-card prompt.
- Added `charactersToIntroduce` to the Chapter Mission schema, provider output
  schemas, normalizer, prompt, mock fixtures, and desktop author summaries.
  A declared character remains provisional through drafting and can enter
  Story State only through the existing Canon Patch commit path.
- Removed the hard-coded normalizer fallback and required at least one
  character per scene in both provider and local schemas.
- Required every scene character to be either a committed Story State ID or an
  explicitly declared Chapter Mission ID before writing `scene_cards.json`.
- Rejected unknown IDs, display names, and empty lists before creating scenes
  or `draft_v1.md`.
- Rejected provisional IDs that collide with committed IDs or duplicate
  another declaration.
- Updated mock and fake fixtures to declare first-use character IDs instead of
  pre-seeding Story State in fresh-project tests.
- Recorded `CHAPTER_SCENE_CARDS_INVALID_PROVIDER_OUTPUT` with a bounded queue
  failure reason while preserving Story State.

### First-Chapter Regression Closure

The first I4 implementation allowed only already-committed characters. Because
new projects intentionally begin with an empty character list, that rule made
real Chapter 1 generation impossible. A new integration test reproduced the
failure from an empty Story State and required the mission to declare
`char_lincheng` before any scene could reference it.

The first full-suite rerun then found eight legacy tests that pre-seeded
`char_lincheng`, causing the new declaration to collide with committed state.
Those preconditions were removed so cancellation, recovery, workload, lease,
drafting, and Electron tests now exercise the real fresh-project path. The
Electron fake was also updated to enforce the current prompt and output-schema
contract instead of returning an obsolete mission shape.

### GREEN Evidence

```text
corepack pnpm exec vitest run \
  tests/integration/chapterNarrativeReferences.test.ts \
  tests/integration/chapterMissionCharacterReferences.test.ts \
  tests/e2e/codexTextProviderPipeline.test.ts \
  tests/e2e/codexDryRunPipeline.test.ts \
  tests/unit/codexMissionNormalizer.test.ts \
  tests/e2e/codexPromptPack.test.ts \
  --reporter=dot
PASS: 6 files, 16 tests

corepack pnpm exec vitest run \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  --reporter=dot
PASS: 4 files, 41 tests

corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/renderer/chapterPlanningGeneration.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx \
  --reporter=dot
PASS: 6 files, 83 tests
```

## I5: Scene-Card Workload Bounds

Status: **CLOSED**

### Verification Of Finding

The finding was valid. The slim prompt requested two scenes, but the provider
schema and normalizer accepted any scene count and unbounded strings. A
three-scene fake response completed drafting and generated three scene files
before any desktop review limit was applied.

### RED Evidence

The first workload integration run completed successfully instead of rejecting:

- the scene-card provider returned three scenes;
- three `production.write_scene` calls ran;
- `scene_cards.json`, three scene drafts, and `draft_v1.md` were written.

### Production Fix

- Documented the current desktop slim contract in shared limits:
  - exactly 2 scenes;
  - at most 2,000 characters per slim text field;
  - 1 through 8 canonical character IDs per scene;
  - at most 16 items in normalized scene list fields;
  - at most 32 KiB UTF-8 JSON for the scene-card set.
- Applied count, string, and character-array limits in the Codex output schema.
- Applied the same limits and the aggregate byte budget in the slim Zod
  normalizer.
- Revalidated normalized scene cards before writing `scene_cards.json`.
- Rejected over-limit output with bounded invalid-output handling before any
  `write_scene` fan-out, while preserving Story State.

## I6: Bounded Candidate Recovery And Exact Ranking Input

Status: **CLOSED**

### Verification Of Finding

The finding was valid. Partial recovery selected the first requested Markdown
files from an arbitrary directory, while ranking separately scanned and read
every Markdown file. Extra files, alias filenames, and an aggregate payload
above a reasonable prompt budget all reached the ranking provider.

### RED Evidence

The initial integration run failed all three candidate safety cases because
each completed ranking instead of rejecting:

- valid `plan_001.md` through `plan_003.md` plus `plan_004.md`;
- an alias filename (`plan_2.md`);
- three individually valid near-limit files whose aggregate exceeded the
  candidate budget.

Together with I5, the first focused run reported four failed tests.

### Production Fix

- Required the deterministic `plan_001.md` through `plan_NNN.md` sequence.
- Rejected aliases, unexpected files, over-request counts, empty files, files
  above 256 KiB, and candidate sets above 512 KiB.
- Kept partial deterministic subsets eligible for regeneration, but reused a
  set only when all requested candidates are present.
- Validated provider-generated candidate IDs, count, and bytes before writing
  any candidate artifact.
- Passed the ordered validated candidate set and its already-read Markdown
  directly into ranking.
- Removed ranking's independent directory scan and selected-plan fallback
  lookup.
- Preserved bounded queue failure metadata and prevented ranking provider
  invocation for invalid recovery directories.
- Applied the same three-candidate partial-directory limits during desktop
  inspection.

### GREEN Evidence

```text
corepack pnpm exec vitest run \
  tests/unit/codexSceneCardWorkload.test.ts \
  tests/integration/chapterWorkloadBounds.test.ts \
  --reporter=dot
PASS: 2 files, 9 tests

corepack pnpm exec vitest run \
  tests/integration/chapterWorkloadBounds.test.ts \
  tests/unit/codexSceneCardWorkload.test.ts \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/integration/chapterNarrativeReferences.test.ts \
  tests/e2e/codexDryRunPipeline.test.ts \
  tests/e2e/codexTextProviderPipeline.test.ts \
  tests/e2e/codexPromptPack.test.ts \
  --reporter=dot
PASS: 10 files, 65 tests

corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/renderer/chapterPlanningGeneration.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx \
  --reporter=dot
PASS: 6 files, 83 tests
```

## I1: Shared Project Operation Lease And Mutation Revalidation

Status: **CLOSED**

### Verification Of Finding

The finding was valid. The filesystem build lock covered Story Bible and
global planning only. Chapter planning, drafting, and commit relied on
per-`ProjectChapterService` maps and could run concurrently across another
service instance or process. Queue transitions used guarded status/stage
values, but provider wait time left no state or queue revision check before
later canonical writes.

### RED Evidence

The first engine concurrency run failed all three cases:

- a chapter dry-run completed while an independent child process owned the
  existing project lock;
- a commit entered conflict processing while a chapter mission provider was
  paused instead of failing with `PROJECT_OPERATION_LOCKED`;
- a paused planning operation completed after external Story State and queue
  replacement instead of failing stale.

The real desktop service test also failed: two independent
`ProjectChapterService` instances targeting the same project both completed,
and the fake Codex received a second mission call.

### Production Fix

- Generalized the existing filesystem lock implementation while preserving the
  `.novel-loop-build-bible.lock` path and `BUILD_BIBLE_LOCKED` compatibility.
- Added `PROJECT_OPERATION_LOCKED` for chapter planning, drafting, and commit.
- Wrapped `runChapterDryRun`, `runChapterUntilDraft`, and
  `commitChapterState` at their top-level mutation boundaries.
- Reused an existing same-project operation context for nested calls so the
  listed top-level workflows cannot deadlock themselves.
- Captured operation-scoped Story State hash, `latestCommittedChapter`, chapter
  queue hash, target chapter, target status, and target stage.
- Added guarded `FileStore` write checkpoints. Every project write in an
  active chapter operation revalidates the expected state and queue before the
  write; successful queue or Story State writes update the operation's own
  expected hash.
- Forbade Story State writes in planning and drafting contexts.
- Made stale detection sticky. Failure handlers cannot overwrite a queue or
  Story State that changed while the provider was running.
- Kept commit provider restrictions, conflict checks, snapshots, authorization,
  and Story State mutation semantics unchanged.

### Regression Fixture Alignment

The required commit and Electron regressions exposed old I4 fixtures rather
than lease failures. Fresh projects now leave Story State untouched, Chapter 1
missions explicitly declare `char_lincheng`, scene cards use that declared ID,
and the default Canon Patch creates the full canonical character only during
commit. The Electron fake verifies the current mission declaration, character
map, mission-reference blocks, and canonical scene IDs.

The first required Electron E2E rerun retained fake-Codex stderr and identified
the exact remaining rejection: the fake still required the old
`Include characters as an array for every scene.` marker while production now
requires a non-empty canonical-ID character array plus the bounded character
map and mission-reference blocks. The fake rejected both configured JSON
attempts before the UI reported Codex unavailable. Updating that test contract
made the author flow pass. The final negative-contract rerun still rejected
display-name characters, altered prompt bodies, dangerous instructions,
unknown prompts/schemas/operations, and unsafe execution flags.

### GREEN Evidence

```text
corepack pnpm exec vitest run \
  tests/integration/projectOperationLease.test.ts \
  --reporter=verbose
PASS: 1 file, 3 tests

corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterStateProtection.test.ts \
  -t "serializes two real chapter service instances" \
  --reporter=verbose
PASS: 1 test

corepack pnpm exec vitest run \
  tests/integration/projectOperationLease.test.ts \
  tests/integration/buildBibleLifecycle.test.ts \
  tests/integration/planGlobalLifecycle.test.ts \
  tests/integration/buildBiblePlanGlobal.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/integration/chapterDraft.test.ts \
  tests/integration/chapterCommit.test.ts \
  tests/integration/inspectRollbackCommit.test.ts \
  tests/integration/chapterNarrativeReferences.test.ts \
  tests/integration/chapterWorkloadBounds.test.ts \
  --reporter=dot
PASS: 11 files, 43 tests

corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/renderer/chapterPlanningGeneration.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx \
  --reporter=dot
PASS: 6 files, 84 tests

corepack pnpm build
PASS

corepack pnpm test
PASS: 186 files, 501 tests

corepack pnpm --dir apps/desktop check
PASS

corepack pnpm --dir apps/desktop test
PASS: 32 files, 381 tests

corepack pnpm --dir apps/desktop build
PASS

corepack pnpm --dir apps/desktop test:e2e:required
PASS: 6 tests

git diff --check
PASS
```

## Remaining Findings

All eight findings from `whole-branch-review.md` are closed.
