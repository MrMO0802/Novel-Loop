# Task 6 Implementation Report

## Status

Fix round 1 is implemented on top of `1e6325e`. The renderer now keeps async
save results tied to their submitted editor snapshots, resets every editor and
opaque binding when a review refreshes, validates structured mission rows, and
fails closed before drafting when participant preflight cannot be completed.

## RED

The focused regression command was run after adding all fix-round tests and
before changing renderer implementation:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx
```

Result: 2 files failed, 13 tests failed, 10 tests passed, exit 1. The failures
reproduced deferred-save races, stale review reuse, old editor/new token
pairing, changed debt token loss, silent partial character-row filtering,
open participant preflight, generic invalidation copy, false radio/tab
semantics, lost editor focus, and inconsistent placeholder-title rendering.

## GREEN

Exact required four-file renderer command:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
```

Result: 4 files passed, 35 tests passed, exit 0.

Complete renderer regression:

```bash
corepack pnpm --dir apps/desktop exec vitest run tests/renderer
```

Result: 11 files passed, 139 tests passed, exit 0.

Desktop type check:

```bash
corepack pnpm --dir apps/desktop check
```

Result: node, web, and end-to-end TypeScript checks passed, exit 0.

## Fix Behavior

- Mission and plan saves capture an immutable request snapshot plus editor
  generation. A response for older text cannot set the current editor to
  `已保存，等待采用` or expose its revision for adoption; newer text
  remains `未保存`.
- Successful review refresh starts by hiding the old review and closing
  editors, then binds only the returned review, direction, item, debt,
  character, and participant tokens. Rejected, unavailable, and out-of-order
  reads cannot reactivate stale content and expose a bounded Chinese retry.
- Existing debt rows retain their item token after text changes. Nonempty debt
  and character fixtures prove save, comparison, and explicit mission adoption
  behavior. Partially completed character changes are rejected with a field
  error and `aria-invalid` instead of being filtered out.
- Draft participant preflight starts generation only after a successful plan
  read with a selected participant. Empty rosters route to mission repair;
  unavailable and rejected reads show a Chinese return-to-review recovery.
- Mission adoption names `方案候选、方向排序、选定方案、场景规划、场景草稿、章节初稿`.
  Plan adoption names `场景规划、场景草稿、章节初稿`.
- `Untitled Plan` is sanitized in the chooser, editor heading, mounted
  textarea, preview, and comparison source.

## Accessibility

- Each direction now has a separate noninteractive `role="radio"` surface and
  sibling command buttons. Roving focus supports arrow keys, Home/End, Space,
  Enter, wrapping, and confirmation-cancel focus restoration.
- Edit/preview uses ordinary `aria-pressed` segmented buttons instead of false
  tab semantics. Both panels remain mounted, preserving the native textarea
  and its undo history while preview is visible.
- Editor and confirmation headings receive focus, comparison return restores
  the compare trigger, save states remain polite live regions, and structured
  field/preflight failures use alerts and named controls.

## Renderer Boundary

- Changes are limited to Task 6 renderer components, renderer tests/fixtures,
  Chinese messages, chapter CSS, renderer route wiring, and this report.
- No main, preload, shared contract, engine, provider, `.playwright-mcp/`, or
  PNG file changed.
- Opaque tokens remain request-only values. Tests verify no token, internal ID,
  path, raw error, schema name, or run metadata appears in the author UI.
- Saving remains pending and unadopted until the separate comparison and
  confirmation flow calls `adoptRevision`.

## Files

- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDirectionChooser.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftGenerationView.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`
- `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- `apps/desktop/src/renderer/src/styles/chapter.css`
- `apps/desktop/tests/renderer/chapterParticipantRepair.test.tsx`
- `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`
- `apps/desktop/tests/renderer/desktopApiFixtures.ts`
- `.superpowers/sdd/2026-08-04-novel-loop-desktop-author-control/task-6-report.md`

## Concerns

The Task 5 mission request represents a bound debt only by `debtTokens`; it has
no token-plus-text field. The renderer therefore preserves the debt identity as
required and shows the author's edited text in comparison, while the public
request can transmit only the existing token. Expanding that contract is out of
scope for this renderer-only fix round.
