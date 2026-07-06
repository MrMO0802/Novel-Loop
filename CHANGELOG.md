# Changelog

## v2.5.0-rc.1

Release candidate packaging for the accepted M26.5 / v2.4.0 Codex pilot baseline.

- Set package and CLI version to `2.5.0-rc.1`.
- Added a release-candidate execution plan in `Plan.md`.
- Added a v2.5.0-rc.1 release checkpoint document.
- Added operator documentation for the Codex pilot as a P0 deliverable.
- Added Commit Safety Journal hardening for normal mock commits and confirmed Codex controlled commits, with audit detection for incomplete journals.
- Kept the supported delivery surface focused on deterministic mock workflows, the read-only Codex execution boundary, `provider=codex-text`, controlled single-chapter commit, Codex single-chapter smoke, Codex multi-chapter pilot for chapters 1-3, and M26.5 progressive Codex runtime benchmarks.
- Marked internal/experimental CLI surfaces in help and docs so included diagnostic commands are not treated as stable RC APIs.
- Marked `providers list` entries with RC release status so legacy `real` / `openai` providers remain visible but out of scope.
- Clarified that real Codex smoke should remain optional/non-required in CI because it depends on a local Codex binary and login state.
- Clarified that dependency audit noise should be isolated from the required build/test gate.

Known limitations:

- This release candidate does not add DeepSeek, OpenAI API calls, CodexAgentConnector, workspace-write mode, Web UI behavior, Codex historical recommit, Codex stale regeneration commit, or broader real Codex multi-chapter stability guarantees.
- M27 output/runtime optimization work is intentionally excluded from the release-candidate commitment.
- Commit Safety Journal is a focused diagnostic record, not a broad filesystem transaction manager.
- Commit Safety Journal detects incomplete commits through audit; it does not perform automatic recovery.
- Real Codex pilot behavior still depends on the user's local Codex binary, login state, model behavior, and host performance.

## v2.4.1-codex-runtime-benchmark

Added M26.5 Codex runtime stabilization and progressive benchmark support:

- Added `codex benchmark --level health|bible|plan|draft|preview|confirm|chapter2|chapter3|all`.
- Added `CodexRuntimeBenchmarkReportSchema` and `CodexRuntimeFailureReportSchema`.
- Benchmark reports record stage duration, Codex call counts, retry/repair/timeout counts, prompt/schema/output/raw JSONL byte counts, artifact counts, Story State mutation status, and suggested retry commands.
- Added stage timeout handling with `CODEX_TIMEOUT` failure reports that keep Story State unmutated.
- Added progressive resume support so confirm can reuse preview artifacts and committed chapters are not repeated.
- Added `--compare-profiles clean,debug` profile comparison output.
- Run Manifest v2 prompt calls now include prompt, context, schema, output, and raw JSONL byte counts.
- Audit, artifact index, and run lineage now recognize Codex runtime benchmark and runtime failure reports.
- Fake Codex fixtures now support deterministic timeout and missing-output benchmark scenarios.

Known limitations:

- This does not add DeepSeek, OpenAI API calls, CodexAgentConnector, workspace-write mode, Web UI behavior, Codex historical recommit, Codex stale regeneration commit, or conflict recovery for Codex.
- Long-form quality optimization remains out of scope; reports are runtime/provenance diagnostics.
- Real Codex benchmark duration depends on the user's local Codex binary, login, model behavior, and host runtime.

## v2.4.0-codex-multi-chapter-pilot

Added M26 Codex multi-chapter pilot:

- Added `codex multi-chapter-pilot` and `pnpm run demo:codex-multi-chapter` for a controlled chapters 1-3 Codex pilot.
- Each Codex chapter now follows draft, preview-only controlled commit, confirmed commit, local quality report, validate, and audit traceability.
- Added `CodexMultiChapterPilotReportSchema`, `CodexCrossChapterDriftReportSchema`, and `CodexBudgetReportSchema`.
- Added `audit/codex_multi_chapter_pilot_report_vN.json/.md`, `audit/codex_cross_chapter_drift_report_vN.json/.md`, and `audit/codex_budget_report_vN.json/.md`.
- Added deterministic cross-chapter drift checks for latest chapter, queue status, canon facts, timeline, placeholders, reader state, debts, foreshadowing, duplicates, and diagnostics normalization warnings.
- Added `evaluate-continuity <projectId> --chapters 1-3` for read-only local drift evaluation.
- Added per-chapter Codex call/runtime/exec timeout controls and budget reports that stop before uncontrolled Story State mutation.
- Diagnostics score normalization now writes explicit `normalizationWarnings` into diagnostics and Codex quality reports.
- Fake Codex fixtures now produce chapter-scoped outputs for chapters 1-3.
- Audit and artifact index now recognize M26 Codex pilot, drift, and budget reports.

Known limitations:

- M26 does not add DeepSeek, OpenAI API calls, CodexAgentConnector, workspace-write mode, Web UI behavior, Codex historical recommit, Codex stale regeneration commit, or Codex conflict auto-repair commit.
- The multi-chapter pilot is scoped to normal next chapters 1-3.
- Cross-chapter drift checks are deterministic engineering checks, not long-form literary quality evaluation.

## v2.3.0-codex-single-chapter-loop

Added M25 Codex single-chapter full-loop hardening:

- Layered Codex health now separates binary availability, login, doctor health, exec smoke, exec JSON, and provider availability; doctor failures are non-blocking when smoke/json pass.
- Confirmed Codex controlled commit now reuses valid preview artifacts by default and blocks stale reuse with `CODEX_PREVIEW_STALE`.
- Added `--rerun-codex-on-confirm` for explicit confirmed re-generation.
- Added `codex_commit_consistency_report_vN.json` to compare preview and confirmed patch/state-diff artifacts.
- Codex canon patch extraction now saves both `canon_patch_codex_proposal_vN.json` and `canon_patch_codex_normalized_vN.json` before compatible `canon_patch.json` commit.
- Added deterministic local chapter quality reports at `codex_chapter_quality_report_vN.json/.md`.
- Added `evaluate-chapter` CLI for local chapter quality checks without provider calls or Story State mutation.
- Added `codex_patch_failure_report_vN.json` for controlled commit patch/schema failures with redacted diagnostics and retry suggestions.
- Added `codex single-chapter-smoke` and `pnpm run demo:codex-single-chapter`, writing `audit/codex_single_chapter_smoke_report_vN.json/.md`.
- Extended artifact index, run lineage, and audit checks for M25 Codex reports and controlled-commit safety invariants.

Known limitations:

- M25 still does not add DeepSeek, OpenAI API calls, CodexAgentConnector, workspace-write mode, Web UI behavior, Codex multi-chapter pilot, Codex historical recommit, or Codex stale regeneration commit.
- The local quality report is deterministic engineering QA, not a long-form literary quality judge.
- Real Codex single-chapter smoke remains dependent on the user's local Codex binary, login, and model behavior.

## v2.2.0-codex-controlled-commit-mock

Added M24 Codex controlled commit:

- Added a controlled `chapter --provider codex-text --commit` path for the normal next uncommitted chapter.
- Without `--confirm-codex-commit`, Codex commit runs preview-only and writes diagnostics, revision plan, final text, `canon_patch_codex_proposal_vN.json`, and a state diff without mutating Story State.
- With `--confirm-codex-commit`, the local engine validates the proposal with `CanonPatchSchema`, runs conflict checks, records approval, creates before/after snapshots, applies the patch locally, and writes commit reports.
- Added `codex_approval_record_vN.json`, `codex_commit_report_vN.json`, and compatible `commit_report.json` output for confirmed Codex commits.
- Added M24 slim Codex schemas/prompts for revision plan and canon patch proposal.
- Added Run Manifest v2 events for `CODEX_COMMIT_PREVIEW_CREATED` and `CODEX_COMMIT_APPROVAL_RECORDED`, plus `codex_controlled_commit` state mutations.
- Added fake Codex scenarios for valid controlled commit, invalid patch schema, conflict, and diagnostics fail.
- Stale regeneration commit, manual recommit, and historical recommit remain blocked for `codex-text` with explicit M24 error codes.

Known limitations:

- M24 does not add DeepSeek, OpenAI API calls, CodexAgentConnector, workspace-write mode, Web UI behavior, or Codex historical/stale commit.
- Codex controlled commit is intentionally limited to `latestCommittedChapter + 1`.
- Codex output quality still depends on local Codex behavior; local schemas and conflict checks remain the final gate.

## v2.1.0-codex-dryrun-hardening

Added M23 Codex novel dry-run hardening:

- Split `plan-global --provider codex-text` into smaller Codex tasks for global outline text, volume outline text, minimal arc map JSON, minimal chapter queue JSON, and validation summary.
- Added slim Codex output schemas under `schemas/codex-output/slim/` for strategy, planning, chapter mission, plan candidates, ranking, scene cards, and diagnostics.
- Added Codex slim output normalizers that convert provider-shaped JSON into the internal Zod schemas before writing application artifacts.
- Added normalization failure artifacts at `codex/failures/<runId>/normalization_error.json`.
- Added Codex JSON retry and repair controls: `--codex-json-retries`, `--codex-json-repair`, and `--codex-json-repair-retries`.
- Added `CodexJsonFailureReportSchema` and failure reports under `codex/failures/<runId>/codex_failure_report.json`.
- Improved Codex error classification for missing output, invalid JSON, schema validation failure, repair failure, timeout, plugin warnings, and skill manifest warnings.
- Added runtime profile support with `--codex-profile default|clean|debug`; profile data is recorded in Run Manifest v2 prompt provenance.
- Added a Codex-specific prompt pack under `prompts/codex-text/` for dry-run planning, drafting, diagnostics, and JSON repair.
- Added a minimal context manifest builder that writes `codex/context/context_manifest_vN.json` and excludes raw run/artifact dumps from prompt context.
- Hardened fake Codex tests for split tasks, retry/repair, failure reports, profile provenance, minimal context, and dry-run/draft Story State immutability.

Known limitations:

- `codex-text` still cannot commit Story State; `chapter --provider codex-text --commit`, `commit-chapter`, `recommit`, and stale regeneration commit remain blocked with `CODEX_TEXT_COMMIT_BLOCKED`.
- M23 does not add DeepSeek, OpenAI API integration, CodexAgentConnector, workspace-write mode, or Web UI behavior.
- Real Codex success still depends on local Codex installation/login/model behavior; failure artifacts are retained for diagnosis.

## v2.0.0-codex-text-provider-mock

Added M22 CodexTextProvider integration over the local Codex execution boundary:

- Added `provider=codex-text` implementing the existing `LLMClient` boundary with text and schema-constrained JSON generation.
- Added provider capability declarations and provider registry commands: `providers list` and `providers inspect codex-text`.
- Wired `codex-text` into `build-bible`, `plan-global`, `chapter --dry-run`, and `chapter --until draft`.
- Added `--codex-bin <path>` options for provider-backed generation commands.
- Added provider-level output schemas under `schemas/codex-output/` for planning, diagnostics, canon patch extraction, and strategy response contracts.
- `generateJson()` now passes `--output-schema` to Codex and performs local parse/schema validation again before returning.
- CodexTextProvider prompt calls write Run Manifest v2 provenance with `provider=codex-text`, `transport=cli`, Codex version, read-only sandbox, schema path, raw/final/parsed output paths, hashes, latency, parse status, schema status, and redaction metadata.
- Codex raw output is redacted before persistence, and `NLE_REDACT_PROMPT_ARTIFACTS=true` remains supported for prompt artifact redaction.
- Added safety gates that block `codex-text` from post-draft full production, `chapter --commit`, conflict repair commit, stale regeneration commit, `commit-chapter`, and `recommit` with `CODEX_TEXT_COMMIT_BLOCKED`.
- Added fake-Codex tests for provider health, text/json generation, malformed JSON, schema failure, pipeline integration, provenance, redaction, audit compatibility, and Story State immutability.

Known limitations:

- `codex-text` is intentionally limited to generation through draft; it cannot commit Story State in M22.
- Real Codex output quality depends on local Codex login/model behavior and may need prompt/schema hardening in M23.
- No DeepSeek, OpenAI API, CodexAgentConnector, workspace-write mode, or Web UI behavior was added.

## v1.9.0-codex-execution-boundary-mock

Added M21 local Codex CLI execution boundary:

- Added `novel-loop codex status`, `codex smoke`, `codex exec-text`, and `codex exec-json`.
- Added local Codex binary discovery and clear `CODEX_BINARY_NOT_FOUND` errors.
- Added Codex login/doctor health checks with redacted output.
- Added read-only `codex exec` invocation using `--sandbox read-only`, `--json`, and `--output-last-message`; JSON mode passes `--output-schema`.
- Added Codex raw JSONL, final output, and parsed JSON artifacts under `codex/runs/<runId>/`.
- Added Run Manifest v2 and `events.ndjson` provenance for Codex calls.
- Added Codex artifact types to artifact index and run lineage.
- Added output-schema JSON validation before writing parsed JSON artifacts.
- Added tests for missing binary, smoke args, JSON parsing, Story State immutability, provenance, redaction, audit strict compatibility, and CLI help.

Known limitations:

- Codex boundary is not yet wired into `LLMClient` or chapter generation.
- Shell-command prevention is enforced as an execution-boundary policy plus read-only sandbox; full CodexTextProvider policy negotiation is reserved for M22.
- No DeepSeek, OpenAI API, or Web UI behavior was added.

## v1.8.0-release-hardening-mock

Added M20 release hardening for the deterministic mock baseline:

- Added deterministic long-project stress fixtures for 1-50 chapter projects without provider calls.
- Added `stress-fixture` CLI command for large local mock projects.
- Added retention preview/apply workflow with `retention/runs/` preservation and `audit/retention_report_vN.json`.
- Added provenance compaction preview/apply workflow with `audit/provenance_compaction_vN.json` and compacted schema-valid event logs.
- Extended artifact index and project audit reports with performance metadata.
- Optimized audit lineage checks by precomputing latest artifact writers instead of scanning all run manifests for every artifact.
- Added clean scripts: `clean:demo`, `clean:test`, and `clean:generated`.
- Added release checklist script and `docs/release/M20_RELEASE_CHECKLIST.md`.
- Added e2e coverage for stress fixtures, retention, compaction, large-project index/audit stability, release commands, clean scripts, and release docs.

Known limitations:

- Retention moves old run directories locally; it does not implement remote archival or object-store retention.
- Provenance compaction keeps structural event summaries and original local event logs, but does not provide external observability export.
- Stress fixtures validate engineering shape and scale, not prose quality.
- No real provider or Web UI behavior was changed.

## v1.7.0-run-provenance-v2-mock

Added M19 run provenance hardening for the deterministic mock baseline:

- New runs now write Run Manifest v2 with `schemaVersion: "2"`, resolved execution context, redaction policy, summary counts, artifact lineage, queue transitions, state mutations, snapshots, archives, reuse policy records, prompt calls, and errors.
- Added append-only `runs/<runId>/events.ndjson` with structured run, stage, artifact, prompt, queue, state mutation, snapshot, and error events.
- Added `RunEventSchema`, `RunManifestV2Schema`, artifact lineage records, queue transition records, state mutation records, snapshot run records, archive run records, reuse policy run records, redaction policy records, and legacy run manifest compatibility.
- Added `RunContext` and `ProvenanceRecorder` helpers around the existing `RunLogger` boundary.
- Prompt telemetry now records prompt input/output artifact paths, hashes, parse status, mock scenario, latency, retry count, and redaction metadata.
- Queue lifecycle updates and canon patch commits now record provenance without allowing LLM output to overwrite Story State directly.
- `run` browser output now supports `--events`, `--artifacts`, and `--state`.
- `artifacts --refresh` now merges Run Manifest v2 lineage with filesystem scanning.
- `audit` validates event logs, lineage hashes, prompt artifact hashes, state mutation snapshot references, run summaries, and legacy run compatibility.
- Added e2e coverage for Run Manifest v2, event logs, artifact lineage, queue transition provenance, state mutation provenance, prompt redaction, run browser v2, provenance audit, and legacy run compatibility.

Known limitations:

- Event logs are local NDJSON files and are not streamed to an external observability backend.
- Provenance records structural lineage and hashes; it does not judge prose quality.
- Mutable canonical files such as live Story State and chapter queue are treated as current-state artifacts, so audit avoids treating superseded historical hashes as corruption.
- No real provider or Web UI behavior was changed.

## v1.6.0-audit-archive-observability-mock

Added M18 production audit and observability hardening for the deterministic mock baseline:

- Stale regeneration now writes a verifiable full archive under `chapters/chapter_YYY/archive/history_edit_<timestamp>/`.
- Archive manifests now record copied artifacts, missing artifacts, sha256 hashes, file sizes, invalidation source, stale chapter status, and regeneration run id.
- Added `ArtifactIndexSchema`, `SnapshotAuditReportSchema`, `ProjectAuditReportSchema`, and `ReusePolicyReportSchema`.
- Added `artifacts` CLI command with `--refresh`, chapter/type/status filters, and JSON output.
- Added run browser commands: `runs` and `run`.
- Added snapshot browser commands: `snapshots`, `snapshot`, and `verify-snapshots`.
- Added `audit` command with `--strict` and `--fix-index`.
- Added stale regeneration `--reuse-policy` with default `reference_only`.
- Added reuse policy reports at `chapters/chapter_YYY/reuse_policy_report_vN.json`.
- Audit verifies archive hashes, run manifests, queue/state consistency, stale pollution, snapshot/base snapshot health, and index presence.
- Added e2e coverage for full archive copies, archive hash corruption, artifact index filtering, run browser, snapshot browser, project audit, reuse policy defaults/downgrades, and CLI help.

Known limitations:

- Archive copying is filesystem-level and does not deduplicate unchanged blobs.
- Scene structure validity check is conservative and currently downgrades stale scene preservation to `reference_only`.
- Project audit focuses on engineering integrity, not long-form prose quality.
- No real provider or Web UI behavior was changed.

## v1.5.0-downstream-invalidation-mock

Added M17 historical recommit rebase and downstream invalidation for the deterministic mock baseline:

- Historical recommit remains blocked by default with `HISTORICAL_RECOMMIT_BLOCKED`.
- `recommit --allow-historical-recommit --mark-downstream-stale` now creates a preview without mutating Story State or queue state.
- Confirmed historical recommit requires `--allow-historical-recommit --mark-downstream-stale --confirm`.
- Historical recommit now resolves a base state from the initial project state for chapter 1 or the `after_chapter_{N-1}_commit` snapshot for chapter N.
- Canon patches are schema-validated and conflict-checked against the base state before rebase.
- Confirmed rebase creates before/after snapshots, rewinds live `state/story_state.json` to the edited chapter, and marks downstream chapters `stale_due_to_history_edit`.
- Added `DownstreamInvalidationReportSchema`, `HistoricalRecommitReportSchema`, `RegenerationPlanSchema`, and archive manifest schema coverage.
- Added `stale` and `regeneration-plan` CLI commands.
- Added `chapter next --regenerate-stale`, which chooses the earliest stale chapter, writes an archive manifest, reruns the full chapter pipeline, and commits through canon patch.
- `validate` now understands historical latestCommittedChapter rollback when downstream stale reports exist, and rejects Story State facts or timeline events from stale chapters.
- Added deterministic fixtures for valid historical chapter 2 recommit, historical conflict, and stale chapter 3 regeneration.
- Added e2e coverage for historical blocking, stale-mark requirement, preview-only behavior, confirmed rebase, stale inspection, regeneration plan, stale regeneration success/failure, missing base snapshot, conflict against base, and M13-M16 regression.

Known limitations:

- No real provider behavior was changed.
- No Web UI was added.
- Historical rebase does not attempt automatic semantic conflict recovery for downstream chapters; stale chapters must be regenerated or explicitly reviewed.
- Archive support writes a manifest of old artifacts but does not copy every old file into the archive directory yet.

## v1.4.0-human-review-recommit-mock

Added M16 human review, state diff, and controlled recommit for the deterministic mock baseline:

- Added `review`, `diff-state`, and `recommit` CLI commands.
- Added `ManualReviewReportSchema`, `RecommitReportSchema`, `StateDiffReportSchema`, and `ApprovalRecordSchema`.
- `review` is read-only and summarizes chapter queue status, diagnostics, conflicts, artifacts, Story State context, and suggested next commands.
- `diff-state` writes JSON and Markdown state diff artifacts for snapshot-to-snapshot comparison or patch preview.
- `recommit --from-final` extracts `canon_patch_manual_vN.json`, writes review and diff artifacts, and only mutates Story State when `--confirm` is passed.
- `recommit --from-patch` copies and validates a manually edited patch, runs conflict checks, writes diff previews, and commits only when confirmed and clean.
- Confirmed recommits write `approval_record_vN.json`, `recommit_report_vN.json`, and before/after snapshots.
- Historical chapter recommit is blocked by default with `HISTORICAL_RECOMMIT_BLOCKED`.
- Added deterministic manual fixtures for final extraction, valid manual patch, invalid schema patch, and still-conflicting patch.
- Added e2e coverage for review read-only behavior, state diff modes, recommit preview, confirmed recommit, manual patch failure modes, historical recommit safety, and M15/M13 regression.

Known limitations:

- Historical recommit downstream invalidation is reserved but not implemented beyond default blocking.
- Recommit conflict repair does not extend M15 automatic recovery; manual edit remains the intended M16 path.
- Real provider behavior and Web UI were not changed.

## v1.3.0-conflict-recovery-mock

Added M15 canon patch conflict recovery for the deterministic mock baseline:

- Added `ConflictReportSchema`, `PatchRepairPlanSchema`, and `ConflictRepairReportSchema`.
- Blocking canon patch conflicts now write `conflict_report_vN.json`, mark the chapter queue item blocked at `commit`, and preserve `state/story_state.json`.
- `chapter --repair-conflicts --max-conflict-repairs <n>` can repair safe mock conflicts, write `patch_repair_plan_vN.json` and `canon_patch_repaired_vN.json`, revalidate schema, rerun conflict checks, and then commit.
- Successful repair writes `conflict_repair_report_vN.json` with `committed=true`; `commit_report.json` records `repaired=true` and patch/report paths.
- Failed, malformed, or still-conflicting repairs write `needs_human_review.md` and `failure_report.json` without mutating Story State.
- Queue resume now handles blocked conflict reports and interrupted commits with existing repaired patches.
- Added deterministic chapter 4 conflict fixtures for timeline order, character state overwrite, invalid debt transition, reader knowledge leak, unrecoverable critical conflicts, malformed repair, and still-conflicting repair.
- Added e2e coverage for default blocking, successful repair, recoverable scenarios, failed repair, schema protection, conflict recheck protection, resume, and versioned reports.

Known limitations:

- Conflict repair is deterministic local patch rewriting, not a real LLM repair workflow.
- Human review/recommit workflows are intentionally not implemented in this milestone.
- Real provider behavior and Web UI were not changed.

## v1.2.0-queue-resume-mock

Added M14 chapter queue lifecycle, resume, and idempotency controls:

- `chapter_queue.json` now tracks chapter lifecycle status, current stage, completed stages, run id, timestamps, failure reason, commit time, and artifact path.
- Chapter planning, drafting, diagnostics/revision, canon patch extraction, and commit stages update the queue as they run.
- `novel-loop chapter <projectId> next --provider mock --resume --commit` resumes the first failed or in-progress chapter.
- Resume reuses valid existing artifacts and continues from mission, plan candidates, ranking, scene cards, scene drafts, draft assembly, diagnostics, canon patch, or commit as appropriate.
- `--force-stage <stage>` can explicitly regenerate a non-committed stage; committed chapters remain protected.
- Failure injection covers mission, plan candidates, scene cards, scene 002 writing, diagnostics, revision, canon patch extraction, and commit.
- `validate` checks chapter queue schema and obvious queue/Story State contradictions.
- Added queue lifecycle, resume, idempotency, and failure injection e2e tests.

Known limitations:

- Conflict recovery remains blocking only.
- Resume validates existing artifacts but does not attempt to repair malformed artifacts automatically.
- No Web UI or additional real provider behavior was added in this milestone.

## M13

Added multi-chapter mock progression:

- `novel-loop chapter <projectId> next --provider mock --max-revisions 2 --commit` resolves from committed Story State.
- Explicit chapter 2 and chapter 3 mock progression are supported.
- Repeat chapter commit is rejected by default before state mutation.
- Chapter 2 and chapter 3 mock fixtures cover mission, plan candidates, scene cards, scene drafts, diagnostics, and canon patches.
- Story State now supports `escalated` / `resolved` narrative debt statuses and `partially_paid` / `resolved` foreshadowing statuses.
- E2E coverage verifies three committed chapters, correct `next` resolution, chapter 2 mission debt continuity, and chapter 3 canon fact append behavior.

## v1.0.0-mock-baseline

Release audit target for the deterministic mock baseline.

Completed capabilities:

- Deterministic mock demo from `examples/brief.md` through chapter 1 commit.
- Local-first CLI project lifecycle: `init`, `validate`, `build-bible`, `plan-global`, `chapter`, `inspect`, `rollback`, and `commit-chapter`.
- Schema-validated JSON artifacts for config, Story State, planning, diagnostics, revision plans, canon patches, commit reports, snapshots, and run manifests.
- Chapter planning, scene-card generation, drafting, diagnostics, bounded revision, finalization, canon patch extraction, conflict checks, and Story State commit.
- Before/after snapshots and run manifests with prompt request/response artifacts.
- Release audit, artifact audit, side-effect regression tests, and deterministic mock regression tests.

Known limitations:

- Mock fixtures cover the chapter 1 baseline only.
- Real provider support exists, but the v1 mock baseline does not require or validate live API keys.
- Conflict handling is blocking, not auto-repairing.
- Multi-chapter progression and queue advancement are not yet frozen.
- No Web UI is included.
