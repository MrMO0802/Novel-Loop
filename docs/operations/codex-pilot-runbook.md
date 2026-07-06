# Codex Pilot Operator Runbook

## Purpose

This runbook explains how to operate the `v2.5.0-rc.1` Codex pilot safely. It is scoped to the accepted M26.5 / v2.4.0 baseline and does not cover DeepSeek, OpenAI API, Web UI, CodexAgentConnector, historical recommit, or stale-regeneration commit through Codex.

## Preconditions

- Node.js 20+
- Corepack available
- `pnpm@10.12.1`
- Optional for real Codex smoke: local `codex` binary installed and logged in

Install dependencies:

```bash
corepack pnpm install
```

Verify local build and tests:

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm novel-loop --version
```

## Safety Boundary

Codex pilot execution uses the local Codex CLI behind Novel Loop Engine's provider boundary.

Default safety posture:

- `sandbox=read-only`
- Workspace writes are not allowed by default.
- Shell command execution is not allowed by default.
- Codex does not write Story State.
- Story State mutation is performed only by local schema validation, conflict checks, approval records, snapshots, and canon patch application.
- Confirmed commits write `commit_journal_vN.json`; audit reports incomplete journals as blocking issues.
- Auth files, API tokens, and `.env` files must not be read into prompts or written to logs.

## Health Check

Run:

```bash
corepack pnpm novel-loop codex status
corepack pnpm novel-loop codex smoke
```

Expected result:

- `codex status` reports binary/login/doctor/smoke/json health details.
- `codex smoke` passes only when the local Codex environment is usable.

If the binary is missing or login is unavailable, stop real Codex smoke and continue only with mock regressions. Do not mark this as a required CI failure.

## Mock Baseline Regression

Run the deterministic mock baseline before and after Codex pilot changes:

```bash
corepack pnpm clean:demo
corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible demo-novel --provider mock
corepack pnpm novel-loop plan-global demo-novel --provider mock
corepack pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop validate demo-novel
corepack pnpm novel-loop audit demo-novel --strict --fix-index
```

## Codex Single-Chapter Smoke

Run only when local Codex health is good:

```bash
corepack pnpm run demo:codex-single-chapter
```

The smoke initializes a clean project, runs Codex strategy/planning, drafts chapter 1, creates preview-only commit artifacts, confirms by local validation and patch application, then runs validate/audit/inspect.

This is the verified real-Codex pilot workflow for `v2.5.0-rc.1` when the operator's local Codex binary and login are healthy.

Expected artifacts:

- `projects/codex-single/audit/codex_single_chapter_smoke_report_vN.json`
- `projects/codex-single/audit/codex_single_chapter_smoke_report_vN.md`
- Chapter 1 draft/final/patch/commit artifacts.
- Run Manifest v2 and `events.ndjson` provenance.

## Codex Multi-Chapter Pilot

Run only after single-chapter smoke succeeds:

```bash
corepack pnpm run demo:codex-multi-chapter
```

The pilot advances chapters 1-3 with per-chapter preview and confirm checkpoints.

This workflow remains experimental/pilot-only in `v2.5.0-rc.1`; it is not a production stability guarantee for unattended long Codex runs.

Expected artifacts:

- `projects/codex-multi/audit/codex_multi_chapter_pilot_report_vN.json`
- `projects/codex-multi/audit/codex_cross_chapter_drift_report_vN.json`
- Per-chapter controlled commit artifacts.
- Run Manifest v2 and event logs.

Resume an interrupted pilot:

```bash
corepack pnpm run demo:codex-multi-chapter -- --resume
```

## Progressive Benchmark

Use the M26.5 benchmark levels to isolate failures:

```bash
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level health --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level bible --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level plan --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level draft --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level preview --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level confirm --codex-profile clean --timeout-ms 180000
```

Continue to chapter 2 and chapter 3 only after earlier levels pass:

```bash
corepack pnpm novel-loop codex benchmark --project-id codex-bench --level chapter2 --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --level chapter3 --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop validate codex-bench
corepack pnpm novel-loop audit codex-bench --strict --fix-index
```

## Failure Handling

For Codex JSON or schema failures:

```bash
corepack pnpm novel-loop providers inspect codex-text
corepack pnpm novel-loop runs <projectId> --status failed
corepack pnpm novel-loop run <projectId> <runId> --events
corepack pnpm novel-loop artifacts <projectId> --refresh
```

Inspect redacted failure artifacts:

- `projects/<projectId>/codex/failures/<runId>/codex_failure_report.json`
- `projects/<projectId>/codex/runs/<childRunId>/raw_output.jsonl`
- `projects/<projectId>/codex/runs/<childRunId>/final_output.json`
- `projects/<projectId>/codex/runs/<childRunId>/parsed_output.json`

Do not bypass schema validation, conflict checks, approval records, or snapshots to force a commit.

## What Not To Do In This RC

- Do not add DeepSeek.
- Do not add OpenAI API integration.
- Do not add Web UI.
- Do not enable workspace-write Codex mode.
- Do not promise unattended real Codex multi-chapter stability.
- Do not use Codex for historical recommit or stale-regeneration commit.
- Do not let Codex directly overwrite `state/story_state.json`.
