# Task 7 Report: Bounded Codex Chapter Adjustments

## Scope

Implemented bounded local Codex adjustments for a chapter mission and any
trusted plan direction. Every successful AI result is stored as a `ready`,
unadopted `codex_adjustment` author revision. Selection, active artifacts,
chapter queue state, `latestCommittedChapter`, and Story State remain unchanged
until the existing explicit adoption operation succeeds.

## RED / GREEN

- RED: provider tests failed because the two descriptors, strict normalizers,
  and adjustment service did not exist.
- GREEN: fake-Codex mission and plan adjustments produced ready unadopted
  revisions through the Task 2 author-revision service.
- RED: desktop main tests failed because adjustment task kinds, strict request
  contracts, trusted gateway methods, and fixed handlers did not exist.
- GREEN: strict token resolution, one-active-operation lifecycle, opaque result
  tokens, cancellation, and safe candidate projection passed.
- RED: renderer tests exposed disabled direction adjustment plus missing mission
  adjustment and participant-repair controls.
- GREEN: the inline instruction, progress, cancellation, comparison, explicit
  adoption, and keep-current flows passed without changing the active direction.
- RED/GREEN audit: a multibyte output below the character ceiling but above 2
  MiB initially passed; the local normalizer now enforces UTF-8 bytes. Task
  contract tests also now reject failed tasks carrying results and task/candidate
  kind mismatches.

## Schemas And Prompts

- Prompt `planning.adjust_chapter_mission_slim` uses descriptor
  `CodexSlimChapterMissionAdjustmentOutputSchema` and
  `planning.chapter_mission_adjustment.slim.schema.json`.
- Prompt `planning.adjust_plan_candidate_slim` uses descriptor
  `CodexSlimPlanAdjustmentOutputSchema` and
  `planning.plan_adjustment.slim.schema.json`.
- Mission output is a strict complete slim mission normalized into
  `ChapterMissionSchema`, with chapter identity plus character/debt references
  validated against trusted project state.
- Plan output is exactly `title`, `markdown`, `changeSummary`, and
  `preservedConstraints`; arrays and strings are bounded, extra fields are
  rejected, and Markdown is capped at 2 MiB in UTF-8.
- Both prompts forbid Story State mutation, unrequested characters or facts,
  shell commands, workspace writes, direct adoption, active-artifact overwrite,
  and whole-project rewrites.

## Provider Semantics

Each service calls `ProviderFactory.create({ provider: 'codex-text' })` and
issues exactly one `complete()` request. Defaults retain the existing provider
behavior: one JSON retry, JSON repair enabled, and one repair retry. Tests that
exercise invalid JSON/schema output disable retries and repair for deterministic
failure. Fake-Codex evidence is one normal call for each successful adjustment,
zero calls for stale input, overlong instruction, and pre-provider cancellation,
and one call for post-validation cancellation. No real Codex or API key is used.

## Lifecycle And Cancellation

Adjustment task kinds are `mission_adjustment` and `plan_adjustment`; author
stages are `requesting_adjustment`, `validating_adjustment`, and
`ready_for_review`. Main resolves the project root, review/option token, trusted
source bytes, and SHA-256 source hash. The application service checks
cancellation before provider execution and after validated output but before
revision storage, then rechecks source bytes before creating the revision.
Cancelled and failed runs expose no result token and do not write a revision.

Successful main tasks expose only an opaque `chapter_revision_*` token and a
bounded author-facing comparison candidate. Adoption remains the separate Task
5 `adoptRevision` request with invalidation confirmation.

## Story State Evidence

The deterministic integration fixture Story State is 4,859 bytes with SHA-256:

`78fc9654b25e8f1b2cdb137c533bed56cbc1eb83dbeaa5893aa743f4e06fdc33`

The before and after hashes are identical for successful mission adjustment,
successful alternative-plan adjustment, invalid JSON, invalid schema, timeout,
stale source, overlong instruction, both cancellation points, and provider
failure. Tests also compare byte-exact snapshots of Story State, queue,
mission, ranking, selected plan, and both plan candidates.

## Renderer Boundary

Renderer requests are strictly:

- Mission: `{ projectKey, reviewToken, authorInstruction }`
- Plan: `{ projectKey, reviewToken, optionToken, authorInstruction }`

Instructions are capped at 4,000 characters. Strict schemas reject paths,
provider/profile/schema controls, source hashes, revision/engine IDs, and raw
output. Fixed IPC channels and preload methods are used. The participant repair
shortcut submits exactly:

`补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。`

It opens a pending comparison and never auto-adopts.

## Verification

- Root required tests: 3 files, 13 tests passed.
- Desktop required tests: 6 files, 205 tests passed.
- `corepack pnpm build`: passed.
- `corepack pnpm --dir apps/desktop check`: passed.
- `git diff --check`: passed before report creation and is rerun before commit.

## Concerns

- Real Codex execution was intentionally not run; deterministic fake-Codex
  coverage is the required completion path.
- JSON Schema `maxLength` is character-based by standard; the local Zod
  normalizer supplies the required UTF-8 2 MiB enforcement.
- Renderer behavior is covered with jsdom interaction tests. No unrelated
  Playwright artifacts or PNG files were modified.
