# M25 Codex Single-Chapter Full Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `codex-text` so one local Codex-backed chapter can run from project init through preview, confirmed controlled commit, validate, audit, and inspect with auditable failure artifacts.

**Architecture:** Keep `CodexTextProvider` read-only and keep Story State writes local-only. Extend the M24 controlled commit service with preview reuse, normalized patch artifacts, consistency reports, deterministic local quality reports, and smoke reporting. Add script-level orchestration for the single-chapter demo while preserving mock and M23 dry-run behavior.

**Tech Stack:** TypeScript, Node.js 20+, Commander, pnpm, Vitest, Zod, local Codex CLI boundary.

---

### Task 1: Health Gate Layering

**Files:**
- Modify: `src/app/codexBoundary.ts`
- Modify: `src/providers/providerTypes.ts`
- Modify: `src/providers/providerRegistry.ts`
- Modify: `src/cli/commands/codex.ts`
- Modify: `src/cli/commands/providers.ts`
- Test: `tests/e2e/codexHealthGate.test.ts`

- [ ] Write a failing test proving doctor-unhealthy fake Codex is `providerAvailable=true` when smoke/json pass.
- [ ] Run the focused test and verify it fails on missing `providerAvailable`/non-blocking doctor output.
- [ ] Add `providerAvailable` to status/health results and CLI output.
- [ ] Keep binary/login/smoke/json failures blocking, doctor failure warning-only.
- [ ] Run focused test and build.

### Task 2: Controlled Commit Preview Reuse

**Files:**
- Modify: `src/app/codexControlledCommit.ts`
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/artifactIndex.ts`
- Modify: `src/logging/RunLogger.ts`
- Modify: `src/cli/commands/chapter.ts`
- Test: `tests/e2e/codexConfirmReusesPreview.test.ts`
- Test: `tests/e2e/codexPreviewStale.test.ts`

- [ ] Write failing tests for confirm reusing latest preview artifacts without additional Codex calls.
- [ ] Write failing test for `CODEX_PREVIEW_STALE` when Story State changes after preview.
- [ ] Add `--rerun-codex-on-confirm`.
- [ ] Add preview lookup, schema validation, conflict check, current-state hash check, and reuse result fields.
- [ ] Generate `codex_commit_consistency_report_vN.json` for preview/confirm comparison.
- [ ] Run focused tests.

### Task 3: Patch Robustness Artifacts

**Files:**
- Modify: `src/app/codexControlledCommit.ts`
- Modify: `src/schemas/observability.ts`
- Modify: `src/schemas/index.ts`
- Modify: `src/app/artifactIndex.ts`
- Modify: `src/logging/RunLogger.ts`
- Test: `tests/e2e/codexPatchRobustness.test.ts`

- [ ] Write failing tests for `canon_patch_codex_normalized_vN.json`.
- [ ] Write failing test for schema/normalization failure writing `codex_patch_failure_report_vN.json`.
- [ ] Write failing test for conflict report preserving Story State.
- [ ] Add schemas for consistency and patch failure reports.
- [ ] Persist proposal, normalized patch, failure report, and lineage.
- [ ] Run focused tests.

### Task 4: Local Chapter Quality Report

**Files:**
- Create: `src/app/codexChapterQuality.ts`
- Modify: `src/schemas/observability.ts`
- Modify: `src/schemas/index.ts`
- Modify: `src/cli/index.ts` or command registration files
- Modify: `src/app/artifactIndex.ts`
- Modify: `src/logging/RunLogger.ts`
- Test: `tests/e2e/codexChapterQualityReport.test.ts`

- [ ] Write failing test for deterministic `codex_chapter_quality_report_v1.json/.md`.
- [ ] Write failing test for critical issue when final is missing.
- [ ] Implement local checks only: title, approximate word count, scene count, hooks, protagonist/conflict/information delta, placeholders, forbidden phrases, JSON consistency, patch/final sanity, diagnostics hard checks, reader question, next hook.
- [ ] Add optional CLI `evaluate-chapter <projectId> <chapterNumber>`.
- [ ] Record artifact lineage.
- [ ] Run focused tests.

### Task 5: Smoke Report And Script

**Files:**
- Create: `src/app/codexSingleChapterSmoke.ts`
- Create: `scripts/demo-codex-single-chapter.mjs`
- Modify: `package.json`
- Modify: `src/schemas/observability.ts`
- Modify: `src/schemas/index.ts`
- Modify: `src/app/artifactIndex.ts`
- Test: `tests/e2e/codexSingleChapterSmoke.test.ts`
- Test: `tests/e2e/codexSmokeReport.test.ts`

- [ ] Write failing test for `demo:codex-single-chapter`/service producing smoke report with all stages.
- [ ] Assert preview does not mutate Story State and confirm sets `latestCommittedChapter=1`.
- [ ] Generate `audit/codex_single_chapter_smoke_report_vN.json/.md` on success and failure.
- [ ] Include stage commands, run ids, artifacts, failure paths, validate/audit result, quality report, snapshots, and success flag.
- [ ] Add package script `demo:codex-single-chapter`.
- [ ] Run focused tests.

### Task 6: Audit Integration

**Files:**
- Modify: `src/app/projectAudit.ts`
- Test: `tests/e2e/codexSmokeReport.test.ts`
- Test: existing audit tests

- [ ] Write failing test for strict audit recognizing quality/smoke/consistency schemas.
- [ ] Check Codex confirmed commit approval record, state mutation, before/after snapshots, and preview-only no `STATE_MUTATION_APPLIED`.
- [ ] Keep `--fix-index` limited to artifact index refresh.
- [ ] Run focused audit tests.

### Task 7: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document health gate layering, single-chapter smoke, preview reuse, quality report, patch robustness, and safety limits.
- [ ] Add `v2.3.0-codex-single-chapter-full-loop`.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run regular mock demo through `audit --strict --fix-index`.
- [ ] Run fake deterministic Codex smoke tests.
- [ ] Run real Codex single-chapter smoke only if `providerAvailable=true`.

---

## Spec Coverage Notes

- Health gate: Task 1.
- Single-chapter script/smoke report: Task 5.
- Quality report: Task 4.
- Patch robustness and failure reports: Task 3.
- Preview/confirm consistency and reuse: Task 2.
- Audit integration: Task 6.
- Safety scope and docs: Tasks 2, 6, 7.
