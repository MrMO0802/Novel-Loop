# Task 7 Report: Bounded Codex Chapter Adjustments

## Scope

Fix round 1 hardens the Task 7 implementation on top of `5cac6b9`. Local
`codex-text` mission and plan adjustments still produce only a `ready`,
unadopted `codex_adjustment` author revision. They do not select a direction,
change active artifacts or queue state, advance `latestCommittedChapter`, or
write Story State.

## RED / GREEN

- RED: seven provider/application tests exposed permissive mission output,
  lost mission semantics, post-write projection, a source TOCTOU race, and a
  missing final cancellation gate. GREEN: all 25 initial focused tests passed.
- RED: seven main/renderer tests exposed cross-kind stages, same-kind request
  coalescing, late-cancel success publication, missing commit-point signaling,
  stale misclassification, parent-heading focus theft, and enabled conflicting
  controls. GREEN: all 145 focused desktop tests passed.
- RED: a 50-objective mission made the 20,000-character plan context truncate
  into invalid JSON. GREEN: the prompt now receives a bounded, complete JSON
  mission summary.
- Final focused schema/adjustment/revision-store run: 26 tests passed.

## Schemas And Prompts

- `planning.adjust_chapter_mission_slim` uses
  `planning.chapter_mission_adjustment.slim.schema.json` and the local
  `CodexMissionAdjustmentOutputSchema`.
- Mission output is strict and complete at the raw boundary. Required fields
  include mission/chapter identity, objective IDs/types/priorities, both debt
  collections and debt types, participants and introduction metadata,
  character deltas, all four reader-information arrays, forbidden moves,
  emotional curve, and nullable target word count. Extra or missing fields and
  a mismatched chapter number fail validation. Nonblank checks do not trim or
  otherwise transform returned mission strings.
- `planning.adjust_plan_candidate_slim` remains strict over `title`,
  `markdown`, `changeSummary`, and `preservedConstraints`, including the 2 MiB
  UTF-8 Markdown limit.
- Plan requests receive explicit bounded mission JSON rather than the complete
  mission document. The summary remains valid JSON under its 20,000-character
  budget.
- Prompts continue to forbid Story State writes, unrequested canon, shell or
  workspace writes, direct adoption, active-artifact replacement, and
  whole-project rewrites.

## Provider Semantics

Each adjustment creates the fixed local provider with
`ProviderFactory.create({ provider: 'codex-text' })` and issues one business
`complete()` call. Existing Codex JSON retry/repair behavior remains one JSON
retry with repair enabled and one repair retry. Deterministic failure tests
disable retry/repair where exact call counts matter. No real Codex process,
network API, or API key is required.

## Validation And Persistence

Mission output is normalized into a complete `ChapterMission`, checked against
the trusted mission identity and full Story State character/debt reference set,
and projected into the complete bounded author-facing comparison before any
revision write. Legal newly referenced open debts project and persist; an
unprojectable participant or debt writes no revision.

`createAuthorRevision()` accepts `expectedSourceHash`. The source read used to
populate `record.sourceHash` also performs the expected-hash comparison before
revision files are written. A deterministic mutation between the service
freshness check and that store read returns `AUTHOR_REVISION_SOURCE_STALE` and
leaves no revision. If the record write fails after the atomic working-copy
write, the uncommitted working copy is removed; the record remains the ready
revision commit marker.

## Lifecycle And Cancellation

Adjustment tasks use only `requesting_adjustment`, `validating_adjustment`, and
`ready_for_review`; planning/drafting tasks cannot use adjustment stages in
either `stage` or `completedStages`.

Cancellation is rechecked after the final source read and immediately before
the first revision write. `onCommitPoint` marks the tiny file commit section as
non-cancellable. Main rejects a late gateway result when stop was requested
before that point and publishes neither a result token nor success. Once the
commit point starts, `canCancel` is false and a durable result completes
normally. `AUTHOR_REVISION_SOURCE_STALE` maps to bounded `stale_chapter`.

Adjustment requests have a fingerprint over kind, project, review token,
option token, and instruction. An identical active retry returns the existing
task; a different same-kind request returns `generation_busy` and never joins
the old task.

## Story State Evidence

The deterministic fixture Story State remains 4,859 bytes with SHA-256:

`78fc9654b25e8f1b2cdb137c533bed56cbc1eb83dbeaa5893aa743f4e06fdc33`

Canonical snapshots compare byte-exact Story State, queue, mission, ranking,
selected plan, and both plan candidates. They remain identical after mission
adjustment, alternative-plan adjustment, legal new-debt projection, invalid
output, timeout, stale source, cancellation, and provider failure. Participant
repair produces revision bytes identical to the trusted source mission;
explicit adoption preserves every mission field semantically and leaves Story
State bytes unchanged.

## Renderer Boundary

Renderer requests remain strictly `{ projectKey, reviewToken,
authorInstruction }` for mission and `{ projectKey, reviewToken, optionToken,
authorInstruction }` for plan. No path, provider/profile/schema control, hash,
engine/revision ID, or raw output crosses IPC.

`ChapterAdjustmentPanel` is remounted by review token, artifact kind, option,
and mission request mode. Mission and direction controls are disabled while an
adjustment panel is active. The same-mount participant-repair route suppresses
parent heading focus until the mission editor takes focus. AI participant
repair still uses the fixed instruction and requires explicit adoption.

## Verification

- Required root suite: 3 files, 19 tests passed.
- Required desktop suite: 6 files, 210 tests passed.
- Additional focused revision-store suite: combined focused run, 26 tests
  passed.
- `corepack pnpm build`: passed.
- `corepack pnpm --dir apps/desktop check`: passed.
- `git diff --check`: passed before report update and is rerun before commit.

## Concerns

- Real Codex execution was intentionally not run; deterministic fake-Codex
  coverage is the required path.
- JSON Schema length is character-based; local normalization supplies the
  required UTF-8 byte ceiling.
- The two revision files are individually atomic. The ready record is the
  commit marker; a process crash between atomic writes could leave an
  unreferenced working-copy file, but cannot create an orphan ready revision.
