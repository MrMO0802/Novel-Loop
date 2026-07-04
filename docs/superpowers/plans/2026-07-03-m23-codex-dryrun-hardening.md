# M23 Codex Dry-run Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `provider=codex-text` stable and diagnosable for build-bible, plan-global, chapter dry-run, and chapter draft without allowing Story State commit.

**Architecture:** Keep M22's `LLMClient` boundary and read-only Codex boundary. Add slim provider schemas plus normalizers at the application layer, use provider retry/repair around `generateJson`, and record failure/context artifacts for auditability.

**Tech Stack:** TypeScript, Node.js 20, Commander, Vitest, Zod, local Codex CLI.

---

### Task 1: Codex Provider Options And Runtime Profiles

**Files:**
- Modify: `src/providers/providerTypes.ts`
- Modify: `src/providers/providerRegistry.ts`
- Modify: `src/providers/codexTextProvider.ts`
- Modify: `src/llm/ProviderFactory.ts`
- Modify: `src/app/codexBoundary.ts`
- Modify: CLI command files for `build-bible`, `plan-global`, `chapter`
- Test: `tests/e2e/codexRuntimeProfile.test.ts`

- [ ] Add `CodexProfile = 'default' | 'clean' | 'debug'`.
- [ ] Add `codexProfile`, `codexJsonRetries`, `codexJsonRepair`, and `codexJsonRepairRetries` to provider factory and app inputs.
- [ ] Pass profile through to `codexBoundary`.
- [ ] Record profile in Codex run args and provider prompt provenance.
- [ ] Add CLI flags:
  - `--codex-profile <profile>`
  - `--codex-json-retries <n>`
  - `--codex-json-repair`
  - `--codex-json-repair-retries <n>`
- [ ] Test that clean profile appears in run manifest and fake Codex receives read-only exec args.

### Task 2: Slim Schemas And Normalizers

**Files:**
- Create: `src/providers/codex/slimSchemas.ts`
- Create: `src/providers/codex/normalizers.ts`
- Add: `schemas/codex-output/slim/*.schema.json`
- Test: `tests/e2e/codexTaskSplitter.test.ts`

- [ ] Add slim JSON schemas with shallow objects and `additionalProperties=false`.
- [ ] Register slim schemas for Codex prompt IDs:
  - `planning.generate_arc_map_minimal_json`
  - `planning.generate_chapter_queue_minimal_json`
  - `planning.plan_chapter_mission_slim`
  - `planning.generate_plan_candidates_slim`
  - `planning.rank_plan_candidates_slim`
  - `planning.generate_scene_cards_slim`
  - `diagnostics.diagnose_chapter_slim`
- [ ] Normalize slim arc map to `ArcMapSchema`.
- [ ] Normalize slim chapter queue to `ChapterQueueSchema`.
- [ ] Normalize slim mission/candidates/ranking/scene cards/diagnostics to existing Zod schemas.
- [ ] Write `normalization_error.json` when normalization fails.

### Task 3: Codex Prompt Pack And Minimal Context Builder

**Files:**
- Add: `prompts/codex-text/*.md`
- Create: `src/app/codexMinimalContext.ts`
- Test: `tests/e2e/codexMinimalContext.test.ts`
- Test: `tests/e2e/codexPromptPack.test.ts`

- [ ] Add Codex-specific concise prompts for M23 tasks.
- [ ] Build minimal context manifests at `codex/context/context_manifest_vN.json`.
- [ ] Record included/excluded artifacts and reasons.
- [ ] Ensure Codex prompts use summaries and bounded snippets instead of full raw project artifacts.
- [ ] Record context manifest as a run artifact.

### Task 4: Codex JSON Retry, Repair, And Failure Reports

**Files:**
- Modify: `src/providers/codexTextProvider.ts`
- Modify: `src/app/codexBoundary.ts`
- Create: `src/schemas/codexFailure.ts`
- Export from: `src/schemas/index.ts`
- Test: `tests/e2e/codexJsonRetryRepair.test.ts`
- Test: `tests/e2e/codexFailureClassification.test.ts`

- [ ] Retry failed JSON generation up to `codexJsonRetries`.
- [ ] Use slim schema and shorter prompt for retry when available.
- [ ] Repair parse/schema failures using a `codex-text` repair prompt.
- [ ] Write `codex/failures/<runId>/codex_failure_report.json`.
- [ ] Copy failed prompt/raw/final/error artifacts into the failure directory when available.
- [ ] Classify errors into M23 error codes including invalid JSON, schema validation, missing output, timeout, plugin warning, skill manifest warning, and unknown.
- [ ] Ensure plugin/skill warnings alone do not fail if final output is schema-valid.

### Task 5: Plan-global Task Splitter

**Files:**
- Modify: `src/app/planGlobal.ts`
- Test: `tests/e2e/codexTaskSplitter.test.ts`

- [ ] For `provider=codex-text`, use split prompt IDs:
  - `planning.generate_global_outline_text`
  - `planning.generate_volume_outline_text`
  - `planning.generate_arc_map_minimal_json`
  - `planning.generate_chapter_queue_minimal_json`
  - `planning.validate_and_assemble`
- [ ] Keep successful intermediate markdown and Codex artifacts.
- [ ] Do not write final `arc_map.json` / `chapter_queue.json` unless normalized artifacts pass Zod schemas.
- [ ] Record task-level provenance and context manifest.

### Task 6: Chapter Dry-run And Draft Slim Pipeline

**Files:**
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Test: `tests/e2e/codexDryRunPipeline.test.ts`

- [ ] Use slim prompt IDs and normalizers for Codex mission/candidates/ranking/scene cards.
- [ ] Keep `chapter --provider codex-text --dry-run` and `--until draft` state-safe.
- [ ] Confirm `story_state.json` is unchanged after dry-run/draft.

### Task 7: Docs, Changelog, And Regression

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: full suite

- [ ] Document clean profile, retry/repair, slim schemas, failure reports, minimal context, and commit prohibition.
- [ ] Add changelog `v2.1.0-codex-dryrun-hardening`.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run mock three-chapter demo and `audit --strict`.
- [ ] If local Codex is available, run Codex dry-run demo and report exact success/failure stage.

