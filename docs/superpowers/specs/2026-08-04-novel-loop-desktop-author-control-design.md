# Novel Loop Desktop Author-Controlled Revision Design

Date: 2026-08-04

Status: Approved product direction, written specification pending final review

## Goal

Turn the current read-only generation path into an author-controlled workflow.
At every meaningful creative gate, an author can review the current material,
edit it directly, ask local Codex for a bounded adjustment, compare the result,
and explicitly adopt or reject the change before continuing.

The design preserves the existing trust boundary:

```text
Renderer
-> typed preload API
-> Electron main application service
-> Novel Loop Engine
-> schema-validated atomic artifacts
```

The renderer never receives project paths, never reads or writes project files,
and never executes Codex. No operation in this milestone commits Story State.

## Product Decision

The approved editing model is a hybrid:

1. Markdown-oriented material can be edited directly.
2. Structured material is edited through author-facing forms.
3. Every editable node also offers an optional natural-language adjustment
   request to local Codex.
4. Direct edits and Codex candidates are working copies until the author
   explicitly adopts them.
5. Adopting an upstream change shows and applies a conservative downstream
   invalidation plan. Old artifacts are retained for provenance.

Rejected approaches:

- directly overwriting generated artifacts would erase provenance and make
  recovery ambiguous;
- instruction-only editing would still deny authors precise control;
- a full branching story-version graph is too large for the current desktop
  milestone and remains a later capability.

## Evidence From The Current Pilot

The live chapter-one pilot exposed four concrete gaps:

1. Candidate titles are discarded when candidates are written as Markdown.
   Heading-free candidate files therefore appear as `Untitled Plan`.
2. Alternative directions are intentionally identifier-free and read-only in
   the current desktop contract, so the author cannot select one.
3. Foundation, global planning, mission, selected plan, and draft contracts
   expose read methods but no author revision lifecycle.
4. The chapter-one Story State has no characters and the generated mission
   declared no provisional characters. Scene cards then returned display names
   such as `林默` and `伤者`; the engine correctly rejected those values because
   the scene schema accepts only declared character IDs.

These are product and boundary issues, not reasons to weaken schema validation.

## Delivery Sequence

### Phase A: Current Chapter Loop

Phase A is the next implementation milestone and includes:

- localized and durable chapter direction titles;
- selecting any generated chapter direction;
- direct mission editing;
- direct selected-plan editing;
- bounded Codex adjustment candidates for mission and plan;
- explicit adoption and downstream invalidation;
- provisional-character repair before scene generation;
- direct draft editing and crash-safe local save;
- natural-language recovery for stale edits and invalid character references.

Phase A stops at editable `draft_v1.md`. It does not add diagnostics, final
chapter approval, canon patch, or commit to the desktop application.

### Phase B: Foundation And Global Planning

After Phase A is accepted, apply the same revision model to:

- Story Bible;
- genre contract;
- reader promise;
- style guide;
- global outline;
- volume outline;
- arc map;
- chapter queue.

Markdown documents use the manuscript editor. Arc and queue JSON use bounded
forms backed by their existing schemas. Adopting an upstream revision must show
which uncommitted downstream planning and chapter artifacts become stale.

## Author-Facing Revision Model

Every editable node has four visible states:

- **AI 原稿**: immutable generated source;
- **编辑中**: local author working copy, not used by downstream generation;
- **待采用**: saved working copy or Codex candidate ready for comparison;
- **已采用**: active artifact used by the next stage.

The interface uses author language. It must not expose run IDs, hashes, schema
names, artifact paths, candidate IDs, queue states, or JSON paths.

Each node provides these commands when applicable:

- `编辑`;
- `保存草稿`;
- `放弃修改`;
- `让 AI 按意见调整`;
- `对比修改`;
- `采用此版`;
- `保留当前版`.

Saving a working copy never invalidates downstream artifacts. Adoption is the
only operation that changes the active artifact and therefore the only editing
operation that may invalidate downstream work.

## Chapter Direction Review

### Titles

Candidate generation retains the provider's validated title and ensures every
candidate Markdown artifact begins with exactly one level-one heading. Existing
heading-free artifacts use localized ordinal fallbacks such as `方案一`, `方案二`,
and `方案三`; English fallback copy is removed.

The generated title remains content, not an identifier. Engine-owned candidate
IDs remain internal.

### Direction Selection

The review page presents all directions as peers. The model recommendation is
marked `AI 推荐`, while the current active direction is marked `当前方向`.

Each alternative has:

- full readable content;
- strengths and risks when available;
- `设为本章方向`;
- `编辑后使用`;
- `让 AI 调整此方向`.

The renderer receives an opaque option token. Electron main resolves that token
against a freshly read review and writes the selected candidate through the
engine. The token is not a path or raw engine candidate ID.

Changing direction atomically updates the selected-plan artifact and the
ranking selection fields. The original model recommendation remains visible in
the author revision record.

## Mission Editing

Mission editing uses structured author-facing controls rather than raw JSON.
Editable fields are:

- chapter purpose;
- required objectives;
- narrative promises to advance or introduce;
- participating and newly introduced characters;
- character changes;
- reader knowledge and open questions;
- forbidden moves.

Hidden engine IDs are preserved by Electron main. New characters are entered as
name and role; the engine creates a deterministic project-local provisional ID
and validates uniqueness. The renderer never creates character IDs.

Adopting a mission revision invalidates plan candidates, ranking, selected plan,
scene cards, scene drafts, and assembled draft for that uncommitted chapter.
The confirmation view lists those consequences before adoption.

## Plan Editing

The selected direction uses a focused Markdown editor with preview, word count,
undo, and explicit save status. The editor does not expose the filesystem.

Adopting a selected-plan revision invalidates scene cards, scene drafts, and the
assembled draft. Mission and candidate source artifacts remain valid.

A Codex plan adjustment receives only:

- the current plan;
- the author instruction;
- bounded mission context;
- relevant Story State summary;
- the existing read-only Codex safety settings.

The result is stored as a candidate revision. It is never adopted automatically.

## Draft Editing

The chapter workspace changes from read-only text to a manuscript editor.

Initial Phase A behavior:

- paragraph-preserving plain-text/Markdown editing;
- local autosave after a short idle interval;
- explicit save status;
- crash recovery from the newest valid working copy;
- immutable generated `draft_v1` source;
- author working copy stored separately until adoption;
- no rich-text format conversion;
- no diagnostics or formal chapter commit.

Adopting the author draft updates the active draft artifact atomically and
records source and adopted hashes. Story State remains unchanged.

## Codex Adjustment Experience

`AI 调整` opens an inline instruction panel. It displays what Codex may change and
what it must preserve. The author can cancel while the request is between safe
stages.

Codex remains:

- local CLI only;
- read-only sandbox;
- approval policy `never`;
- no workspace write;
- no shell-command capability;
- no Story State commit capability.

The result opens in the existing comparison pattern. Accept and reject are
local engine operations; Codex cannot perform adoption.

## Provisional Character Repair

Scene generation must never weaken character-reference validation.

Before scene-card generation, the engine computes the available participant
set from:

- committed Story State characters;
- mission `charactersToIntroduce` declarations.

If the set is empty, drafting does not call the scene-card provider. The chapter
is classified as `participant_roster_missing`, and the author is returned to a
mission repair view with this message:

> 本章还没有声明可参与场景的人物。请确认人物后再生成初稿。

The repair view offers:

- direct addition of participating characters;
- a bounded `AI 补全本章人物` candidate;
- return without changing the active mission.

Mission generation is also hardened: when no committed characters exist, a
mission with an empty provisional roster is invalid if the chapter requires
scene generation. Structured-output retry asks Codex to declare the named
participants from the supplied queue item. This remains schema-validated and
does not infer or write Story State facts.

For the existing failed chapter-one project, retry routes to participant repair
instead of repeatedly invoking scene-card generation with an empty map.

## Downstream Invalidation

Adoption uses the following conservative dependency table:

| Adopted node | Invalidated uncommitted downstream nodes |
| --- | --- |
| Mission | candidates, ranking, selected plan, scenes, draft |
| Candidate choice | selected plan, scenes, draft |
| Selected-plan text | scenes, draft |
| Draft text | future diagnostics and revision outputs |
| Story Foundation | global planning and all uncommitted chapters |
| Global planning | affected uncommitted chapter planning and drafts |

Invalidation never deletes old artifacts. Existing files are copied or recorded
in an archive before active outputs are replaced. A schema-validated report
records the reason and affected nodes.

Committed chapters and live Story State are never rolled back by these editing
operations. Editing material that would conflict with committed chapters is
blocked and redirected to the existing historical-review workflow, which is
outside the desktop scope of this milestone.

## Data Model

All new JSON artifacts are schema-first.

### AuthorRevisionRecordSchema

Records:

- revision ID and project/chapter scope;
- artifact kind;
- revision mode: `direct_edit` or `codex_adjustment`;
- source hash and working-copy hash;
- created and adopted timestamps;
- state: `working`, `ready`, `adopted`, `rejected`, or `superseded`;
- author instruction when present;
- downstream invalidation report reference when adopted;
- `storyStateMutated: false`.

### ChapterDirectionSelectionSchema

Records:

- chapter number;
- previous and selected internal candidate IDs;
- whether the selection differs from the model recommendation;
- source review hash;
- selected-plan hash;
- generated timestamp;
- downstream invalidation reference;
- `storyStateMutated: false`.

### AuthorEditInvalidationReportSchema

Records:

- edited node;
- invalidated nodes;
- retained/archive artifact references;
- queue transition;
- reason;
- recovery command or author-facing next step;
- `storyStateMutated: false`.

Renderer-facing contracts expose opaque revision tokens instead of hashes or
paths. Electron main resolves and validates those tokens against current files.

## Storage Layout

Phase A adds versioned chapter artifacts under:

```text
chapters/chapter_XXX/author_revisions/
  mission_revision_vN.json
  mission_revision_vN.md
  plan_revision_vN.json
  plan_revision_vN.md
  draft_revision_vN.json
  draft_revision_vN.md
  direction_selection_vN.json
  edit_invalidation_report_vN.json
```

Autosave working copies live below Electron application data until promoted to
a project revision artifact. This prevents a renderer crash from corrupting the
project and avoids treating every keystroke as durable project history.

All durable project writes use `FileStore`, schema validation where applicable,
and atomic replacement. No renderer code receives or constructs these paths.

## Typed Desktop API

The existing named API grows with narrow methods rather than generic file APIs:

```ts
chapter.readPlan(request)
chapter.saveMissionWorkingCopy(request)
chapter.adjustMission(request)
chapter.adoptMissionRevision(request)
chapter.selectDirection(request)
chapter.savePlanWorkingCopy(request)
chapter.adjustPlan(request)
chapter.adoptPlanRevision(request)
chapter.readDraft(request)
chapter.saveDraftWorkingCopy(request)
chapter.adoptDraftRevision(request)
```

Each request includes only `projectKey`, an opaque review/revision token, and
bounded author content. Each response is a strict discriminated Zod contract.

Foundation and planning receive corresponding domain-specific methods in Phase
B. There is no generic `readFile`, `writeFile`, `invoke`, or `runCodex` API.

## Concurrency And Freshness

Every adoption checks:

- the opaque revision token is current;
- the source artifact hash still matches;
- no conflicting project operation lease is active;
- the chapter remains uncommitted;
- Story State `latestCommittedChapter` has not changed unexpectedly.

A mismatch returns a natural-language stale-edit message and preserves the
working copy. It never silently rebases author text.

## Error And Recovery Language

Required author-facing classifications include:

- `内容已变化，请重新对比后采用`;
- `本章人物尚未准备完整`;
- `AI 返回的调整版暂时无法使用`;
- `方向已更换，原场景和初稿需要重新生成`;
- `你的编辑草稿已恢复，尚未采用`.

Internal error codes remain available only in a collapsed technical detail
section and local provenance.

## Accessibility And Interaction

- Edit, preview, and compare modes are keyboard reachable.
- Selection does not rely on color alone.
- Autosave status uses text and an accessible live region.
- Confirmation focus returns to the triggering control when cancelled.
- Long candidate text uses stable readable widths and does not resize controls.
- Buttons use concise Chinese labels and one intent per label.
- No English fallback copy appears in the Chinese locale.

## Testing Strategy

### Engine

- provider-defined candidate IDs and heading-free text normalize to durable
  localized candidates;
- direction selection updates ranking and selected plan atomically;
- mission adoption invalidates the correct dependency set;
- plan adoption invalidates only scenes and draft;
- provisional-character absence blocks before provider invocation;
- participant repair produces legal scene-card character references;
- all edit and selection operations leave Story State unchanged;
- stale revision tokens cannot overwrite newer artifacts.

### Electron Main And IPC

- every request and response is schema validated;
- untrusted senders are rejected;
- opaque option and revision tokens cannot escape their project;
- no absolute path, engine ID, auth data, or raw Codex output reaches renderer;
- one project operation lease covers generation, adjustment, and adoption.

### Renderer

- Chinese titles render for current and legacy candidates;
- every direction can be expanded, selected, edited, or adjusted;
- working-copy, pending-adoption, and active states are visually distinct;
- invalidation confirmation lists affected downstream content;
- participant-roster recovery routes to mission editing;
- draft autosave and crash recovery are announced accessibly.

### Electron E2E

Required flow:

```text
open project
-> review three titled directions
-> select a non-recommended direction
-> edit and adopt it
-> confirm downstream state
-> repair or verify chapter participants
-> generate draft
-> edit and autosave draft
-> restart Electron
-> recover working copy
-> verify Story State hash is unchanged
```

## Acceptance Criteria

Phase A is accepted when:

1. No chapter direction displays `Untitled Plan` in the Chinese UI.
2. The author can select any candidate and see the active direction change.
3. The author can directly edit mission, selected plan, and draft.
4. The author can request a bounded Codex adjustment for mission and plan.
5. No generated or edited candidate is adopted without an explicit action.
6. Upstream adoption clearly reports and retains invalidated downstream work.
7. The current chapter-one participant failure has a deterministic recovery
   path and no longer loops on scene-card generation.
8. Draft generation succeeds with schema-valid character references.
9. Renderer remains isolated from Node, paths, filesystem, and Codex commands.
10. Story State and `latestCommittedChapter` remain unchanged throughout the
    desktop flow.

## Non-Goals

- DeepSeek or OpenAI API providers;
- Web UI or cloud accounts;
- Codex workspace write or CodexAgentConnector;
- diagnostics, final chapter, canon patch, or chapter commit in Electron;
- historical recommit, stale regeneration, or conflict auto-repair in Electron;
- raw JSON or Markdown file management by the renderer;
- full alternate-timeline branching;
- rich-text document format conversion.
