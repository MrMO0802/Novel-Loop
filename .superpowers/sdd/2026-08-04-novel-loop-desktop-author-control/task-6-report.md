# Task 6 Implementation Report

## Status

Fix round 3 is implemented on top of `a5470c7`. The renderer now resolves
submitted character-change bindings to canonical author-facing participant
labels in mission comparison, and asynchronous review loading can no longer
steal focus from a participant-repair editor.

## RED

The two focused renderer files were run after adding round-3 regressions and
before changing renderer implementation:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx
```

Result: 2 files failed, 2 tests failed, 27 tests passed, exit 1.

- The character-binding test proved that selecting a different participant
  transmitted the correct opaque token while the comparison still omitted the
  selected character name and role.
- The deferred repair-read test reproduced the focus race: after the mission
  editor received focus, the parent review effect ran again and moved focus to
  `审阅第 1 章方向`.

## GREEN

Focused round-3 renderer tests:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx
```

Result: 2 files passed, 29 tests passed, exit 0.

Exact required four-file renderer command:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
```

Result: 4 files passed, 40 tests passed, exit 0.

Complete renderer regression, run twice to detect focus flakiness:

```bash
corepack pnpm --dir apps/desktop exec vitest run tests/renderer
corepack pnpm --dir apps/desktop exec vitest run tests/renderer
```

Result: both runs passed independently; each run passed 11 files and 144
tests, exit 0.

Desktop type check:

```bash
corepack pnpm --dir apps/desktop check
```

Result: node, web, and end-to-end TypeScript checks passed, exit 0.

## Fix Behavior

- Every submitted character-change `participantToken` is resolved through the
  canonical participant option map before mission comparison is built.
- Candidate character changes now render as
  `姓名（角色）：原状态 → 新状态；所需证据`, allowing the author to verify
  the material binding before adoption.
- The regression changes the character selector, asserts the exact transmitted
  opaque token, asserts the canonical candidate label, and confirms the token
  itself is not rendered.
- `ChapterPlanReview` now owns route-heading focus in a mount-only effect.
  Review loading and refresh remain in their request effect without any parent
  focus side effect, so a mounted `ChapterMissionEditor` retains focus.
- The deferred repair regression forces the former effect-order race and
  verifies that `编辑本章任务`, not the parent review heading, remains focused.

## Preserved Behavior

- Saving remains unadopted until explicit revision confirmation.
- Mission comparison remains based on the exact submitted draft and canonical
  token-bound story data.
- Existing refresh ordering, participant fail-closed preflight, keyboard
  behavior, live regions, Chinese copy, and internal-identifier protections
  remain covered.

## Renderer Boundary

- No main, preload, shared contract, engine, provider, `.playwright-mcp/`, or
  PNG file changed.
- The implementation is limited to two renderer components, two renderer test
  files, and this report.

## Files

- `apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`
- `apps/desktop/tests/renderer/chapterParticipantRepair.test.tsx`
- `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`
- `.superpowers/sdd/2026-08-04-novel-loop-desktop-author-control/task-6-report.md`

## Concerns

None. Character changes can only select canonical participant options, and an
unexpected unresolved binding is represented with bounded Chinese copy rather
than an opaque token.
