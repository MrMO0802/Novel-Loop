# Novel Loop Desktop Chapter Planning And Draft Workspace Design

Date: 2026-07-29

Status: Approved direction, implementation specification

## Goal

Open the author journey after global planning. An author can create the next
canonical-sequence chapter, watch a recoverable planning task, review the
chapter mission and selected plan, explicitly approve that direction, generate
scene cards and a first draft, and read the result in an author-facing chapter
workspace.

This milestone stops at `draft_v1.md`. It does not run diagnostics, create a
revision candidate, write `final.md`, extract a canon patch, or modify canonical
Story State.

## Product Decision

The approved product direction is a two-gate flow:

1. Generate and review chapter planning.
2. Require explicit author confirmation before generating scenes and prose.

This preserves author control without exposing the engine's candidate ranking,
queue state machine, schemas, run IDs, paths, or Codex JSONL.

Rejected alternatives:

- planning-only would immediately create another dead end;
- one-click generation through draft would hide a meaningful creative decision;
- invoking the CLI from Electron would duplicate parsing and weaken typed
  boundaries;
- allowing renderer filesystem access would violate the desktop trust model.

## Scope

### Included

- Enable `创建下一章` from global planning review and Project Overview.
- Resolve the target as `latestCommittedChapter + 1`.
- Refuse missing, stale, committed, or out-of-sequence queue targets.
- Generate:
  - `mission.json`;
  - three plan candidates;
  - `ranking.json`;
  - `selected_plan.md`.
- Show author-facing planning progress with safe stop and retry.
- Review:
  - chapter title and purpose;
  - required objectives;
  - story promises to advance;
  - character movement;
  - reader information changes;
  - forbidden moves;
  - selected plan;
  - bounded summaries of alternatives.
- Require explicit confirmation before prose generation.
- Generate:
  - `scene_cards.json`;
  - individual scene drafts;
  - `draft_v1.md`.
- Show draft-generation progress with safe stop and retry.
- Present a first Chapter Workspace:
  - chapter navigation summary on the left;
  - readable draft in the center;
  - chapter mission and scene summary on the right;
  - visible draft status and Story State protection note.
- Preserve partial valid artifacts and resume from the last safe stage.
- Keep all renderer payloads bounded and author-facing.

### Excluded

- Manual draft editing and autosave.
- Editing mission, selected plan, or scene cards.
- Diagnostics, revision, candidate comparison, and quality gates.
- `final.md`, canon patch, state diff, approval, snapshots, or commit.
- Historical recommit, stale regeneration, or conflict repair.
- DeepSeek, OpenAI API, Web UI, or Codex workspace write.
- Provider selection in the renderer.

Manual editing remains part of the approved product MVP, but it belongs to the
next milestone because it requires an autosave, revision, and crash-recovery
contract rather than a simple text field.

## Author Flow

```text
Global Planning Review
-> Create Next Chapter
-> Confirm generation
-> Planning progress
-> Chapter Plan Review
-> Confirm plan and generate draft
-> Draft progress
-> Chapter Workspace
```

Project Overview chooses the same destination:

- complete global plan and no chapter plan: create next chapter;
- chapter planning in progress or partial: resume planning;
- plan ready and no draft: review chapter plan;
- draft ready: open Chapter Workspace.

## Canonical Sequence

Electron main resolves the project root from the opaque project key, reads
Story State and chapter queue through the engine boundary, and computes:

```text
targetChapter = latestCommittedChapter + 1
```

The target must exist in `chapter_queue.json`. A committed target, a sequence
gap, or a stale chapter is rejected with natural recovery guidance. The
renderer never supplies an arbitrary chapter number for the create-next action.

## Engine Lifecycle

The existing `runChapterDryRun` and `runChapterUntilDraft` implementations
remain the business source of truth. They gain optional lifecycle hooks rather
than desktop-specific branches:

```ts
type ChapterPlanningProgressStage =
  | 'preparing'
  | 'mission'
  | 'plan_candidates'
  | 'ranking'
  | 'finalizing'
  | 'completed';

type ChapterDraftProgressStage =
  | 'preparing'
  | 'scene_cards'
  | 'scene_drafts'
  | 'draft_assembly'
  | 'finalizing'
  | 'completed';
```

The `scene_drafts` progress event carries bounded positive `current` and `total`
counts because scene count is dynamic.

Both lifecycle APIs support:

- `onProgress`;
- `shouldStop`;
- safe reuse of already-valid artifacts;
- cancellation before the next provider call;
- failure provenance through the existing run logger;
- unchanged Story State.

Planning cancellation leaves completed mission or candidate artifacts intact.
Draft cancellation leaves completed scene artifacts intact. Retry resumes
without overwriting valid completed work.

The chapter queue continues to record its existing lifecycle states. Desktop
code does not invent a second queue model.

## Desktop Engine Boundary

Add an engine-facing desktop module that accepts an absolute project root only
from Electron main:

```ts
inspectDesktopNextChapter(input)
planDesktopNextChapter(input)
readDesktopChapterPlan(input)
draftDesktopChapter(input)
readDesktopChapterDraft(input)
```

The wrapper always uses `codex-text`, derives `projectId` and `projectsRoot`,
and does not accept provider, prompt, shell, commit, force-stage, stale
regeneration, or arbitrary artifact options from the renderer.

Read results contain only bounded author-facing values. They omit:

- absolute and relative artifact paths;
- run IDs and request IDs;
- raw queue statuses and failure reasons;
- schema names and JSON paths;
- prompt text and raw model output;
- auth data and Codex command arguments.

## Shared Contract

Use a dedicated strict `chapterContract.ts`. Do not expand the global planning
contract into a generic task shape.

The public contract includes:

- opaque `projectKey`;
- opaque planning and drafting task IDs;
- chapter number and planned title;
- author-facing task stage and status;
- completed stages;
- cancellation and retry capability;
- classified natural-language error kind;
- bounded plan review;
- bounded draft review.

Plan review includes the mission, selected plan, and alternative summaries.
Ranking scores remain hidden. Draft review includes safe text, scene summaries,
word count, and a `draft` status marker.

All request and response objects are strict Zod schemas. Markdown and total
payloads have byte limits.

## Electron Main And IPC

Add a `ProjectChapterService`, engine gateway, and fixed IPC handlers following
the established Foundation and Planning patterns:

- trusted sender checks;
- strict request and response validation;
- one active chapter task per project across both planning and drafting;
- idempotent repeated starts;
- in-memory bounded terminal-task retention;
- cooperative stop;
- safe retry;
- no path-bearing errors;
- no dynamic channel or command names.

Planning and drafting are separate author decisions and therefore separate task
operations. A draft task may start only when a complete, schema-valid plan
review exists.

## Renderer Experience

### Global Planning Review

Replace the disabled button with `创建第 N 章`. The supporting copy states that
the next step prepares the chapter direction first and does not yet write
prose.

### Planning Generation

Use the existing restrained full-width task layout. Show:

- preparing chapter context;
- defining the chapter task;
- comparing possible approaches;
- selecting the strongest direction;
- preparing review.

Stop means "finish the current safe step and pause". Retry resumes completed
work.

### Chapter Plan Review

The page presents:

- chapter number, title, and primary purpose;
- required chapter goals;
- mysteries or promises advanced;
- character and reader changes;
- forbidden moves;
- selected plan as readable text;
- collapsed alternative summaries.

The primary action is `确认方向并生成草稿`. It requires a confirmation dialog or
inline confirmation state and clearly says Story State is not changed.

### Draft Generation

Progress presents scene planning, scene drafting, and chapter assembly. Dynamic
scene count is shown as `正在写第 X / Y 个场景`.

### Chapter Workspace

Use the approved Quiet Project Space layout:

- a compact left rail for current chapter and project navigation;
- a dominant manuscript column;
- a quieter right context panel;
- no nested cards or dashboard metrics;
- no editor controls until manual editing is implemented.

The manuscript is explicitly labelled `初稿`. The next action is visibly
reserved for chapter review in the following milestone.

## Error And Recovery

Author-facing categories:

- Codex unavailable;
- login required;
- usage limit reached;
- timeout;
- invalid generated result;
- global plan missing;
- chapter not found in the plan;
- chapter already committed;
- stale chapter requires a different recovery flow;
- another chapter task is active;
- project unavailable;
- unexpected failure.

Every terminal error states whether generated work can be resumed and confirms
that Story State was not changed.

Application restart recovery is artifact-based: inspect the target chapter and
route to partial planning, plan review, partial draft generation, or completed
draft. In-memory task IDs are never required after restart.

## Security And Data Protection

- Renderer remains sandboxed with context isolation.
- Renderer cannot access Node.js, filesystem, shell, Codex, or project paths.
- Codex remains `read-only`.
- Desktop cannot select mock or another provider.
- Desktop cannot pass commit, recommit, stale regeneration, force-stage, or
  conflict-repair flags.
- JSON artifacts pass existing schemas before atomic write.
- Existing valid artifacts are reused, not silently overwritten.
- Story State is hashed before and after planning and drafting in integration
  tests.
- Chapter queue changes are limited to existing non-canonical planning and
  drafting lifecycle transitions.
- No final, patch, diff, snapshot, approval, or commit artifact is produced.

## Testing

Tests cover:

- engine progress, stop, resume, artifact reuse, and state protection;
- next-chapter resolution and queue safety;
- desktop wrapper provider pinning and payload filtering;
- task idempotency, mutual exclusion, cancellation, retry, and retention;
- plan and draft contract bounds;
- trusted IPC sender validation;
- preload surface;
- route selection after restart;
- planning review content and keyboard navigation;
- explicit confirmation before draft generation;
- draft workspace content and status distinction;
- fake Codex exact allowlist;
- production Electron flow from global plan through `draft_v1`;
- existing project, Foundation, global planning, mock, and Codex regressions.

## Acceptance Criteria

1. The global planning review offers a working `创建第 N 章` action.
2. The target chapter is derived from current Story State, not renderer input.
3. Planning generates mission, candidates, ranking, and selected plan through
   local Codex.
4. The author can stop and safely resume planning.
5. The plan review contains no internal paths, IDs, raw JSON, or ranking scores.
6. Drafting begins only after explicit author confirmation.
7. Scene cards, scene drafts, and `draft_v1.md` are generated and schema-checked
   where applicable.
8. The Chapter Workspace visibly distinguishes the result as an initial draft.
9. Planning and drafting leave Story State byte-for-byte unchanged.
10. No final, canon patch, state diff, snapshot, approval, or commit artifact is
    generated.
11. The renderer cannot invoke arbitrary Codex, shell, filesystem, provider, or
    chapter operations.
12. Root, desktop, and required Electron E2E suites pass.
