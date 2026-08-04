# Task 6 Implementation Report

## Status

Complete. Chapter-plan review is now an author-controlled Chinese workflow:
all directions are visible as peers, mission and plan edits remain pending until
explicit adoption, and every direction/adoption invalidation is confirmed.

## RED

The initial focused run was executed after adding the renderer behavior tests:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx
```

Result: 2 files failed, 11 tests failed, exit 1. The failures showed the old
read-only alternatives, absent direction commands, absent mission/plan editors,
absent revision comparison/adoption, and generic participant failure handling.

## GREEN

Exact required renderer command:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
```

Result: 4 files passed, 22 tests passed, exit 0.

```bash
corepack pnpm --dir apps/desktop check
```

Result: node, web, and end-to-end TypeScript checks passed, exit 0.

Additional renderer regression:

```bash
corepack pnpm --dir apps/desktop exec vitest run tests/renderer
```

Result: 11 files passed, 126 tests passed, exit 0.

## UI Behavior

- One bordered peer list renders every direction's complete safe Markdown,
  strengths, risks, `AI 推荐`, and `当前方向` labels. Every inactive option has
  `设为本章方向`; every option has `编辑后使用`; the Task 7 AI adjustment is
  visibly disabled with a next-phase tooltip.
- Direction selection names `场景规划、场景草稿、章节初稿`, requires explicit
  confirmation, refreshes the public review after success, and never renders
  the `Untitled Plan` fallback.
- The mission editor supports purpose, repeatable objectives/promises/character
  changes/reader information/forbidden moves/emotional beats, existing and new
  participants, and target word count. Saves preserve opaque item bindings and
  send only the Task 5 request shape.
- Any direction can be edited without first becoming active. The Markdown
  editor provides native text editing, an author-safe preview, Chinese character
  count, and `未保存` / `已保存，等待采用` / `已采用` states.
- Source/candidate comparison contains author-facing content only. Adoption
  requires a second invalidation confirmation and calls `adoptRevision` with
  `confirmInvalidation: true`.
- Stale, participant-roster, invalid-output, busy, and project-unavailable
  outcomes map to fixed Chinese copy. Drafting checks the public participant
  selection before start and routes missing rosters to the mission editor.

## Accessibility

- Direction choices expose radio-group/radio semantics and textual selected
  state in addition to color.
- Route, editor, comparison, and confirmation headings receive focus.
- Cancelling direction and draft confirmations restores focus to the trigger.
- Save, selection, and adoption states use polite live regions; failures use
  alerts. Form rows have author-facing labels, and icon controls have Chinese
  accessible names and tooltips.

## Renderer Boundary

- Renderer calls only Task 5's named chapter methods. It does not import Node,
  filesystem, shell, provider, engine, schema, or project-path APIs.
- Review, option, item, participant, and revision tokens stay in component
  closures/state. Select values use local numeric indexes; tokens and public
  message keys are never rendered.
- Raw errors and raw Codex content are discarded. Safe Markdown is converted to
  React text nodes, so HTML-like input is visible as text and cannot execute.
- No main, preload, shared contract, engine, provider, `.playwright-mcp/`, or
  PNG file was changed.

## Files

- Added `ChapterDirectionChooser.tsx`, `ChapterMissionEditor.tsx`, and
  `ChapterRevisionCompare.tsx`.
- Updated `ChapterPlanReview.tsx`, `ChapterDraftGenerationView.tsx`, `App.tsx`,
  the Chinese message catalog, and chapter styles.
- Updated the strict renderer API fixture and chapter-plan tests; added the
  participant-repair renderer test.

## Concerns

No blocking concerns. The Task 5 task-error union does not expose
`participant_roster_missing` for an already-started drafting task. Task 6
therefore uses the existing public `readPlan` result as a renderer preflight and
routes an empty selected roster before `startDrafting`; authoring operations
still handle the public participant outcome directly. Existing untracked
Playwright and PNG artifacts remain outside the commit.
