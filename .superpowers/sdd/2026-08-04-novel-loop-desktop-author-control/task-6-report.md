# Task 6 Implementation Report

## Status

Fix round 2 is implemented on top of `30c8f895`. The renderer now presents
token-bound narrative debts as canonical read-only story state, compares the
exact mission content submitted through the Task 5 contract, uses
artifact-specific revision language, and restores direct-adoption focus to the
original mounted editor control.

## RED

The focused behavior command was run after adding the round-2 regression tests
and before changing renderer implementation:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx
```

Result: 1 file failed, 5 tests failed, 18 tests passed, exit 1. The failures
reproduced editable token-bound debt wording, a comparison based on unsent
wording, generic mission/plan labels and confirmation copy, replacement-button
focus after direct mission confirmation cancellation, and a recommendation
badge missing from the radio's accessible description.

The existing authoring outcome table was also extended to cover
`project_unavailable`; the fixture uses the public contract's `invalid`
outcome and verifies that the raw key is never rendered.

## GREEN

Exact required four-file renderer command:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
```

Result: 4 files passed, 38 tests passed, exit 0.

Complete renderer regression:

```bash
corepack pnpm --dir apps/desktop exec vitest run tests/renderer
```

Result: 11 files passed, 142 tests passed, exit 0.

Desktop type check:

```bash
corepack pnpm --dir apps/desktop check
```

Result: node, web, and end-to-end TypeScript checks passed, exit 0.

## Fix Behavior

- Bound narrative debts render as canonical text with a Chinese explanation;
  they have no editable or removable control. Only introduced debts expose
  wording fields.
- Mission save requests preserve every bound `itemToken` and send introduced
  wording separately. The comparison resolves bound tokens back to canonical
  review text and uses only the captured submitted draft for all other values.
- Mission comparison uses `本章任务` and `修订后的任务`; its confirmation
  explains the revised task rebuild and names `方案候选、方向排序、选定方案、场景规划、场景草稿、章节初稿`.
- Plan comparison uses `当前方向` and `修订后的方向`, with plan-specific
  confirmation copy and only `场景规划、场景草稿、章节初稿` invalidated.
- Direct mission adoption keeps the editor mounted while confirmation is open.
  Cancelling restores focus to the exact original `采用此版` trigger.
- AI recommendation and active-state badges are associated with each radio via
  its accessible description, independent of color.
- `project_unavailable` maps to bounded Chinese recovery copy and never exposes
  the internal message key.

## Preserved Behavior

- Saving remains pending and unadopted until the separate confirmation calls
  `adoptRevision`.
- Deferred-save generation guards, refresh reset/order handling, participant
  fail-closed preflight, character-row validation, keyboard radio behavior,
  mounted preview textareas, and sanitized direction titles remain covered.
- Opaque tokens remain request-only values and are never displayed to authors.

## Renderer Boundary

- No main, preload, shared contract, engine, provider, `.playwright-mcp/`, or
  PNG file changed.
- All new visible copy is Chinese and focus/live-region behavior remains
  accessible.

## Files

- `apps/desktop/src/renderer/src/features/chapter/ChapterDirectionChooser.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`
- `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- `apps/desktop/src/renderer/src/styles/chapter.css`
- `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`
- `.superpowers/sdd/2026-08-04-novel-loop-desktop-author-control/task-6-report.md`

## Concerns

None. The renderer now reflects the existing token-only bound-debt contract
without implying that canonical wording can be edited.
