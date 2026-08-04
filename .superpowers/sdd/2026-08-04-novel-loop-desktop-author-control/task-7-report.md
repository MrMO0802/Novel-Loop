# Task 7 Report: Bounded Codex Chapter Adjustments

## Scope

Fix round 2 hardens Task 7 on top of `9e3d0be`. Local `codex-text`
mission and plan adjustments still create only a `ready`, unadopted
`codex_adjustment` author revision. No adjustment selects a direction, changes
an active artifact or queue item, advances `latestCommittedChapter`, or writes
Story State.

## RED / GREEN

- RED: malicious participant-repair output could change objectives, reader
  information, emotion, and word count. General mission output also accepted
  unknown or duplicate objective IDs. GREEN: the fixed repair instruction is a
  trusted intent and source-aware merge accepts only participants and
  introduction metadata; objective identities are source-owned and unique.
- RED: application validation missed Task 5 path/artifact leakage forms and
  desktop publication could fail only after a ready revision existed. GREEN:
  one browser-safe validator is shared by pre-persistence projection and the
  IPC contract, while publication capacity and entropy are reserved before the
  gateway call and every pre-publication failure discards the ready revision.
- RED: desktop wrappers reread the working copy after commit, task-kind stages
  were not exact, bounded Story State used an invalid raw JSON slice, and repair
  focus could land on the parent heading. GREEN: candidate bytes are returned
  in memory, lifecycle consistency is strict, summaries remain parseable JSON,
  and explicit repair-entry generations control initial and same-mount focus.
- The new storage cleanup regression first failed because
  `discardReadyAuthorRevision()` did not exist, then passed after the
  ready-record/working-copy cleanup path was implemented.

## Schemas And Prompts

- `planning.adjust_chapter_mission_slim` uses
  `planning.chapter_mission_adjustment.slim.schema.json` and the strict local
  `CodexMissionAdjustmentOutputSchema`.
- Mission output remains complete at the raw boundary: chapter identity,
  objective type/priority, debt types, reader deltas, emotional curve, target
  word count, participants, introductions, and identity fields are required.
  Missing fields, extra fields, and a mismatched chapter number are invalid.
- `planning.adjust_plan_candidate_slim` remains strict over `title`,
  `markdown`, `changeSummary`, and `preservedConstraints`, including the 2 MiB
  UTF-8 Markdown limit.
- Plan context is an explicit bounded mission summary. Story State context is
  built from bounded list items and strings, then serialized as complete JSON;
  it is never truncated as raw JSON text.
- Prompts continue to forbid Story State writes, unrequested canon, shell or
  workspace writes, direct adoption, active-artifact replacement, and
  whole-project rewrites.

## Provider Semantics

Each adjustment fixes the provider to local `codex-text` and issues one
business `complete()` call. Only the existing configured structured-output
retry/repair behavior remains: one JSON retry with repair enabled and one
repair retry. Fake-Codex tests are deterministic; no real Codex process, API,
network provider, or API key is required.

## Trusted Mission Scope

The exact instruction
`补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。`
is classified in main and revalidated in the application service as
`participant_repair`. Its candidate is built from the trusted source mission
with only `participatingCharacterIds` and `charactersToIntroduce` replaced.
All objective, debt, reader, emotional, word-count, identity, and other mission
fields come from the source.

The malicious fake output changes every major non-participant section while
adding a participant; the stored revision preserves every unrelated field by
deep semantic equality. General mission adjustment rejects unknown and
duplicate model objective IDs and validates chapter, mission, character, debt,
participant, introduction, and objective references before persistence.

## Validation Boundary

`novel-loop-engine/author-facing` is a browser-safe shared implementation used
by both application candidate validation and desktop IPC schemas. It rejects
`selected_plan.md`, `file://`, POSIX, Windows/UNC and relative paths, internal
artifact filenames and IDs, encoded forms, hashes, schema names, and Task 5
internal key/value forms while allowing normal author prose and web URLs.

The complete author-facing mission or plan projection, including trusted
participant/debt labels, is built and parsed before `createAuthorRevision()`.
An unprojectable or leaking output writes no revision. A leaking result from a
fake desktop gateway fails as bounded `invalid_output`, publishes no result
token, and invokes ready-revision cleanup.

## Commit And Publication

Adjustment services return the already validated in-memory candidate and
working-copy content; desktop wrappers perform no post-commit working-copy
reread. `ChapterReviewTokenStore` reserves opaque revision-token capacity and
entropy before the long gateway call. The complete final `ChapterTaskSchema`
success payload is parsed before the reserved token is bound.

Cancellation or any schema/publication failure after a durable gateway result
calls `discardReadyAuthorRevision()`. Cleanup requires a matching ready
`codex_adjustment` revision and source hash, removes the ready record first,
then removes the working copy. Capacity, entropy, final candidate schema, late
cancellation, and publication-failure regressions all assert no published
token and no reachable ready orphan.

## Lifecycle And Renderer

Allowed stages are exact by task kind:

- planning: `preparing`, `mission`, `plan_candidates`, `ranking`, `finalizing`,
  `completed`;
- drafting: `preparing`, `scene_cards`, `scene_drafts`, `draft_assembly`,
  `finalizing`, `completed`;
- adjustments: `requesting_adjustment`, `validating_adjustment`,
  `ready_for_review`.

Terminal status, error, retry/cancel flags, result fields, completed stages,
and scene progress are cross-validated. `AUTHOR_REVISION_SOURCE_STALE` remains
bounded as `stale_chapter`.

`ChapterAdjustmentPanel` remounts by review token, artifact, option/request
mode, and auto-start mode. While an adjustment is running or under review,
mission/direction controls, project back navigation, direction confirmation,
and draft start are disabled. Cancellation or `保留当前版` must resolve the
panel first. Explicit participant-repair entry generations suppress parent
heading focus on initial mount and blur it during deferred same-mount entry;
the mission editor receives focus when its review arrives.

## Story State Evidence

The deterministic baseline Story State remains 4,859 bytes with SHA-256:

`78fc9654b25e8f1b2cdb137c533bed56cbc1eb83dbeaa5893aa743f4e06fdc33`

Byte snapshots cover Story State, queue, mission, ranking, selected plan, and
plan candidates. They remain unchanged after successful adjustments,
malicious participant repair, invalid/leaking output, timeout, stale source,
cancellation, token reservation failure, publication failure, and provider
failure. Revisions remain unadopted until the separate explicit adoption path.

## Verification

- Required root suite: 3 files, 30 tests passed.
- Required desktop suite: 6 files, 218 tests passed.
- Additional adjustment/revision-store suite: 2 files, 34 tests passed.
- `corepack pnpm build`: passed.
- `corepack pnpm --dir apps/desktop check`: passed for node, web, and e2e
  TypeScript configurations.
- `git diff --check`: passed before staging and is rerun before commit.
- No hanging Vitest process remained after verification.

## Concerns

- Real Codex execution was intentionally not run; deterministic fake-Codex
  coverage is the required completion path.
- Revision files are individually atomic. A process crash after working-copy
  creation but before the ready record can leave an unreferenced file, but
  cannot leave a discoverable ready revision. Publication cleanup removes the
  ready record first for the same reason.
