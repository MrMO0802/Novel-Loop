# Novel Loop Desktop Global Planning Integration Design

Date: 2026-07-29

## Goal

Connect the existing Novel Loop `planGlobal` engine capability to the secure
Electron desktop application. After reviewing a complete Story Foundation, an
author can explicitly start global planning, understand progress, recover from a
stopped or failed task, and review the generated global outline, first-volume
outline, story arcs, and chapter plan.

This milestone removes the current dead end after Story Foundation review. It
does not begin chapter generation or modify canonical Story State.

## Approved Product Direction

The existing desktop product design already selects an editor-first,
author-facing application and includes global outline, first-volume outline,
and chapter-list review in the Story Foundation journey. This milestone extends
the accepted Story Foundation workflow instead of introducing a new navigation
model.

The selected implementation approach is to reuse the established secure
background-task pattern:

1. The renderer requests planning through a fixed typed preload API.
2. Electron main resolves the opaque project key and owns the task.
3. The engine invokes the existing local `codex-text` provider.
4. Generated JSON is normalized and validated by existing schemas before write.
5. The renderer receives bounded, author-facing review data, never project paths,
   run IDs, raw JSONL, auth data, or shell controls.

Alternative approaches were rejected:

- invoking the CLI as a child process would duplicate parsing and weaken typed
  boundaries;
- running planning in the renderer would violate sandbox and filesystem rules;
- generating all planning in one Codex call would reduce recoverability and
  schema isolation.

## Scope

This milestone includes:

- A primary `确认故事基础并生成全局规划` action from Story Foundation review.
- A Project Overview action that resumes planning or opens completed planning.
- Four author-visible generation stages:
  - overall story direction;
  - first-volume structure;
  - story arcs;
  - chapter plan.
- Stop requests that take effect before the next Codex call.
- Safe resume of incomplete planning without rewriting valid completed stages.
- Project-scoped generation exclusion using the existing engine build lock.
- Read-only review of:
  - `planning/global_outline.md`;
  - `planning/volume_01_outline.md`;
  - `planning/arc_map.json`;
  - `planning/chapter_queue.json`.
- Natural-language error and recovery states.
- Project Overview refresh after completion.

## Non-goals

- Editing or approving generated planning documents.
- Starting chapter mission, draft, diagnostics, revision, preview, or commit.
- Updating `state/story_state.json`.
- Changing chapter queue lifecycle after its initial planned form.
- Exposing raw artifact paths, JSON, schemas, prompt text, run IDs, or Codex
  events to the renderer.
- DeepSeek, OpenAI API, a web application, or workspace-write Codex access.

## Engine Lifecycle

`planGlobal` gains optional lifecycle controls:

```ts
type PlanGlobalStage =
  | 'preparing'
  | 'global_outline'
  | 'volume_outline'
  | 'arc_map'
  | 'chapter_queue'
  | 'finalizing'
  | 'completed';

interface PlanGlobalProgressEvent {
  stage: PlanGlobalStage;
  state: 'started' | 'completed';
}
```

`PlanGlobalInput` gains:

```ts
onProgress?: (event: PlanGlobalProgressEvent) => void | Promise<void>;
shouldStop?: () => boolean | Promise<boolean>;
resumeIncomplete?: boolean;
```

Before planning begins, the engine verifies the project and all four Story
Foundation documents. It then acquires the existing project build lock so Story
Foundation and global planning cannot write concurrently.

For each planning stage:

1. Check `shouldStop`.
2. If resume is enabled and the output already exists, read and validate it,
   record it as reused, and emit the completed stage.
3. Otherwise invoke Codex, bound or schema-validate the output, atomically write
   it through `FileStore`, and emit the completed stage.

If all four outputs already exist and regeneration is not explicitly enabled,
the engine returns `ARTIFACT_ALREADY_EXISTS`. The desktop application does not
offer destructive regeneration in this milestone.

Cancellation throws `PLAN_GLOBAL_CANCELLED`, records a recoverable run error,
and leaves completed artifacts available for a later resume.

## Desktop Engine Boundary

`src/desktop/globalPlanning.ts` exposes only:

```ts
planDesktopGlobal(input): Promise<DesktopGlobalPlanningResult>
readDesktopGlobalPlanning(input): Promise<DesktopGlobalPlanningReview>
```

The desktop wrapper always selects `codex-text`. It accepts an absolute project
root only from Electron main, derives `projectId` and `projectsRoot`, and does
not accept provider or shell options from the renderer.

The review result contains:

- two bounded Markdown documents;
- author-facing arc records with name, type, summary, chapter range, and related
  characters;
- author-facing chapter records with chapter number, title, summary, primary
  function, and planned status.

No filesystem path, `artifactPath`, `latestRunId`, internal timestamps, or
failure reason crosses into the renderer.

## Electron Main and IPC

Planning uses a dedicated `ProjectPlanningService`, contract, gateway, and IPC
registration. It follows the Foundation service rules:

- one active planning task per project;
- idempotent concurrent start requests;
- opaque task IDs;
- in-memory bounded terminal-task retention;
- fixed channel names;
- trusted sender checks;
- Zod validation on request and response;
- cooperative stop;
- author-facing error classification.

The planning contract is intentionally separate from the Foundation contract so
future chapter-task states do not grow one generic, weakly typed task model.

## Renderer Experience

### Project Overview

The next action is state-dependent:

| Story Foundation | Global plan | Action |
| --- | --- | --- |
| missing | missing | Prepare Story Foundation |
| complete | missing | Prepare global planning |
| complete | complete | Review global planning |

Story Foundation remains separately reachable while global planning is
complete.

### Story Foundation Review

The review footer explains that planning uses the reviewed foundation as input
and that no formal Story State is changed. The primary action is:

`确认故事基础并生成全局规划`

This confirmation is explicit but does not create a canonical-state approval
artifact. Starting the planning run is the provenance record of the decision.

### Planning Generation

The generation screen mirrors the proven Foundation layout while using planning
language. It shows the current stage, completed stages, safe-stop behavior, and
recovery actions. It never shows Codex CLI details.

### Planning Review

The review uses four tabs:

- 全书方向
- 第一卷
- 故事线
- 章节计划

Markdown is presented as readable text. Arc and chapter JSON are rendered as
semantic lists, never raw JSON. The footer states that planning is a creative
working plan and has not committed a chapter or changed Story State.

The next chapter action remains visibly unavailable in this milestone with copy
that it will open in the following stage. No dead-end ambiguity remains.

## Error Handling

Author-facing categories:

- Codex unavailable;
- login required;
- usage limit reached;
- timeout;
- invalid generated result;
- Story Foundation missing;
- project unavailable;
- planning already complete;
- another generation task is active;
- unexpected failure.

Every terminal error states that Story State was not changed. Retry is offered
only when resuming is safe.

## Security and Data Protection

- Renderer sandbox, context isolation, and permission denial remain unchanged.
- Renderer has no Node.js, filesystem, shell, or Codex process access.
- The provider remains read-only and cannot commit Story State.
- JSON artifacts pass local Zod schemas before atomic write.
- Existing valid planning artifacts are not overwritten during resume.
- Markdown and total review payload sizes are bounded.
- Story State hashes are asserted unchanged in engine and desktop integration
  tests.

## Testing

Tests cover:

- engine progress, cancellation, resume, validation, locking, and state
  protection;
- desktop wrapper output filtering and bounded reads;
- planning service idempotency, retry, error classification, and task retention;
- IPC sender trust and schema validation;
- preload API exposure;
- Project Overview routing;
- Story Foundation confirmation;
- planning generation progress and recovery;
- planning review without technical metadata;
- production Electron smoke for the complete author flow;
- existing Story Foundation and project-library regressions.

## Acceptance Criteria

1. A project with Story Foundation can start planning from the desktop.
2. The author sees four planning stages and can request a safe stop.
3. A stopped or failed task resumes without replacing valid completed outputs.
4. All four planning artifacts are generated through local Codex.
5. Arc map and chapter queue pass their existing schemas before write.
6. The desktop review presents all four artifacts in author-facing language.
7. Story State remains byte-for-byte unchanged.
8. No renderer payload exposes paths, run IDs, raw JSON, JSONL, auth, or shell
   controls.
9. Project Overview marks global planning ready and provides a review action.
10. Root and desktop build/test suites pass.
