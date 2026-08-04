# Task 7 Report: Bounded Codex Chapter Adjustments

## Scope

Fix round 3 hardens Task 7 on top of `63a7651`. Local `codex-text`
mission and plan adjustments create a schema-validated `publishing` author
revision first. Main durably binds its opaque publication token and promotes
it to `ready`; no application-layer adjustment is adoptable before that
promotion. Adjustments never select a direction, overwrite active artifacts,
change queue state, advance `latestCommittedChapter`, or write Story State.

## RED / GREEN

- RED: introduction names and roles outside `participatingCharacterIds` were
  not included in the final mission leakage traversal. Four malicious raw and
  encoded cases produced revisions. GREEN: every author-facing string in the
  merged mission is traversed before persistence; all four cases now return
  `CHAPTER_ADJUSTMENT_INVALID_OUTPUT`, with no record or canonical mutation.
- RED: bounded Story State context selected the first five characters even
  when a mission participant or trusted plan reference appeared later.
  GREEN: mission participants are prioritized first, then plan-referenced
  character IDs, then character deltas and deterministic Story State order.
- RED: capacity reservation removed the oldest published token immediately;
  cancellation, provider, entropy, task-schema, or publication failure could
  therefore invalidate an unrelated author token. GREEN: reservation only
  marks a distinct eviction candidate. Replacement occurs during successful
  publication and is rolled back byte-for-binding on every failure.
- RED: adjustment records became `ready` before main could durably associate
  a token. Schema and storage tests also rejected the proposed publication
  state and metadata. GREEN: `publishing` is schema-defined and non-adoptable;
  bind and promotion are separate atomic record writes with recovery coverage.

The initial focused RED runs observed six mission/context failures, two token
reservation failures, eight main publication/recovery failures, and three
schema/storage failures. The corresponding focused suites passed after the
implementation.

## Schemas And Prompts

- `planning.adjust_chapter_mission_slim` uses
  `planning.chapter_mission_adjustment.slim.schema.json` and the strict local
  `CodexMissionAdjustmentOutputSchema`.
- Mission output remains complete at the raw boundary. Chapter identity,
  objective IDs/type/priority, debt IDs/types, reader deltas, emotional curve,
  word count, participants, introductions, and identity fields are required.
  Missing/extra fields, duplicate or unknown objective IDs, invalid references,
  and a mismatched chapter number are rejected.
- `planning.adjust_plan_candidate_slim` remains strict over `title`,
  `markdown`, `changeSummary`, and `preservedConstraints`, including the 2 MiB
  UTF-8 Markdown bound.
- `AuthorRevisionRecordSchema` now defines `publishing` and strict nullable
  internal publication metadata: opaque revision token, project key, latest
  committed chapter, purpose, and bind timestamp. Paths/project roots are not
  part of that persisted metadata.
- Prompts continue to forbid Story State writes, unrequested canon, shell or
  workspace writes, direct adoption, active-artifact replacement, and
  whole-project rewrites.

## Provider Semantics

Each adjustment fixes the provider to local `codex-text` and issues one
business `complete()` call. Only the existing configured structured-output
retry/repair behavior remains: one JSON retry with repair enabled and one
repair retry. Fake-Codex tests are deterministic; no real Codex process, API,
network provider, or API key is required.

## Mission Fidelity And Projection

The fixed participant-repair instruction is classified in main and rechecked
in the application service as trusted narrow intent. Its source-aware merge
replaces only `participatingCharacterIds` and `charactersToIntroduce`; all
objective, debt, reader, emotion, word-count, identity, and other mission
fields come from the trusted source mission.

General mission adjustment requires existing objective IDs to be unique and
source-owned and validates chapter, mission, character, debt, participant,
introduction, and objective references. The complete merged mission traversal
checks chapter function, objective text, introduced-debt promises, every
character delta field, every introduction name and role independently of the
participant list, every reader-information list, forbidden moves, and the
emotional curve.

`novel-loop-engine/author-facing` remains the single browser-safe leakage
validator used by pre-persistence application validation and desktop IPC. It
rejects artifact filenames, `file://`, POSIX/Windows/relative paths, internal
IDs and key/value forms, hashes, schema names, and encoded equivalents without
blocking ordinary prose. A violation writes no working copy or record and
main publishes neither a token nor a successful task result.

## Durable Publication

Main reserves token entropy/capacity before the provider call. A successful
gateway result is still `publishing` with no metadata. Main then:

1. Parses the complete public success task and candidate.
2. Atomically binds recoverable token metadata to the publishing record.
3. Publishes the reserved token in memory, evicting only its marked candidate.
4. Atomically promotes the record to `ready`.
5. Commits the in-memory publication reservation and exposes task success.

The token store retains the exact previous binding until step 5. Any
cancellation, provider, entropy, final-task schema, bind, token publication, or
promotion failure releases the reservation and preserves that binding. When
all possible eviction candidates are reserved, allocation fails with the
bounded capacity error and changes no published token.

Application storage never writes an adjustment directly as `ready`. Adoption
and normal revision reads reject `publishing`, while internal recovery lists
it without exposing metadata over IPC. Bind failure leaves an unbound
`publishing` record; promotion failure leaves a bound `publishing` record;
cleanup removes the record before its working copy so cleanup failure cannot
leave a discoverable ready orphan.

On plan read or an authoring operation, main scans schema-validated internal
publication records. It retries cleanup for unbound publishing records,
reconstructs the exact opaque token binding for bound publishing/ready
records, and promotes only after the binding is resolvable. Simulated restart
tests cover publishing and ready records. Deterministic storage tests cover
bind-write failure, after-bind promotion failure, record cleanup failure, and
idempotent promotion/recovery.

## Context And Boundary

Story State summaries are always complete bounded JSON, never raw string
slices. Character slots prioritize mission participants and trusted plan
references before deterministic fill; tests place the relevant character
beyond the first five. Lists and strings retain fixed item/character limits and
the small fallback also parses as JSON within the 8,000-character bound.

Renderer requests remain strict `{ projectKey, reviewToken,
authorInstruction }` or `{ projectKey, reviewToken, optionToken,
authorInstruction }`. Renderer receives no root/path, revision ID, source
hash, provider/profile/schema, raw prompt/output/event, publication metadata,
or filesystem capability. Existing task-kind/stage consistency, request
fingerprints, cancellation commit point, adjustment panel isolation, blocked
navigation, and participant-repair focus regressions remain green.

## Story State Evidence

The deterministic baseline Story State remains 4,859 bytes with SHA-256:

`78fc9654b25e8f1b2cdb137c533bed56cbc1eb83dbeaa5893aa743f4e06fdc33`

Byte snapshots cover Story State, queue, mission, ranking, selected plan, and
plan candidates. The new raw/encoded introduction leakage tests assert no
revision and byte-identical canonical snapshots. Existing success, malicious
participant repair, invalid output, timeout, stale source, cancellation,
provider, token-capacity, publication, and recovery-failure tests retain the
same no-auto-adoption and no-canonical-mutation guarantees.

## Verification

- Required root suite: 3 files, 36 tests passed.
- Required desktop suite: 6 files, 230 tests passed.
- Additional schema/revision-store suite: 2 files, 17 tests passed.
- `corepack pnpm build`: passed.
- `corepack pnpm --dir apps/desktop check`: passed for node, web, and e2e
  TypeScript configurations.
- Every Vitest/build/check command used a bounded shell timeout. No test
  process remained running after verification.

## Concerns

- Real Codex execution was intentionally not run; deterministic fake-Codex
  coverage is the required completion path.
- Restart behavior is tested by reconstructing a service/token store from
  persisted publication metadata. It does not simulate an operating-system
  power loss, so filesystem durability remains bounded by the existing atomic
  `FileStore` contract.
