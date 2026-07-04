# M22 CodexTextProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `provider=codex-text` as a safe local Codex CLI backed text/JSON provider for non-commit generation flows.

**Architecture:** Keep M21 `codexBoundary` as the only process-spawn layer. Add a focused `src/providers/` registry/capabilities layer and an `LLMClient` adapter that delegates to `execCodexText` / `execCodexJson`. Existing business pipelines continue to call `ProviderFactory`, which will route `codex-text` through the new adapter while safety gates block state-mutating modes.

**Tech Stack:** TypeScript, Node.js 20, Commander, Vitest, Zod, local Codex CLI.

---

### Task 1: Provider Types And Registry

**Files:**
- Create: `src/providers/providerTypes.ts`
- Create: `src/providers/providerCapabilities.ts`
- Create: `src/providers/providerRegistry.ts`
- Create: `src/cli/commands/providers.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/providers/codexTextProvider.test.ts`

- [ ] **Step 1: Write failing tests** for `listProviders()` and `inspectProvider('codex-text')`, including doctor-unhealthy but exec-success health fields.
- [ ] **Step 2: Verify RED** with `corepack pnpm test tests/providers/codexTextProvider.test.ts`.
- [ ] **Step 3: Implement registry** with `codex-text` capabilities: text, JSON mode, output schema, streaming events, no token usage/cost, workspace read only, no workspace write, CLI transport, read-only sandbox, no commit by default.
- [ ] **Step 4: Implement CLI** `providers list` and `providers inspect codex-text`.
- [ ] **Step 5: Verify GREEN** with provider tests.

### Task 2: CodexTextProvider LLM Adapter

**Files:**
- Create: `src/providers/codexTextProvider.ts`
- Modify: `src/app/codexBoundary.ts`
- Modify: `src/llm/ProviderFactory.ts`
- Test: `tests/providers/codexTextProvider.test.ts`

- [ ] **Step 1: Write failing tests** for `generateText`, `generateJson`, invalid JSON, schema invalid JSON, and redaction.
- [ ] **Step 2: Verify RED** with provider tests.
- [ ] **Step 3: Extend boundary input** to support prompt text directly and explicit operation metadata without duplicating spawn logic.
- [ ] **Step 4: Implement CodexTextProvider** with `complete`, `generateText`, `generateJson`, `getCapabilities`, `healthCheck`, and `estimateCost`.
- [ ] **Step 5: Map failures** to `ProviderError` codes `INVALID_JSON`, `SCHEMA_VALIDATION_FAILED`, `CODEX_EXEC_FAILED`, and `CODEX_BINARY_NOT_FOUND`.
- [ ] **Step 6: Verify GREEN** with provider tests.

### Task 3: Output Schemas

**Files:**
- Create: `src/providers/codex/schemas.ts`
- Create: `schemas/codex-output/*.schema.json`
- Modify: `src/providers/codexTextProvider.ts`
- Test: `tests/providers/codexTextProvider.test.ts`

- [ ] **Step 1: Write failing tests** asserting JSON promptIds resolve to provider output schemas.
- [ ] **Step 2: Add JSON schemas** for arc map, chapter queue, chapter mission, plan candidates, ranking, scene cards, diagnostics, and canon patch extraction.
- [ ] **Step 3: Use explicit output schema** for every `responseFormat: 'json'` request.
- [ ] **Step 4: Verify GREEN** with provider tests.

### Task 4: Pipeline Integration And Safety Gate

**Files:**
- Modify: `src/app/buildBible.ts`
- Modify: `src/app/planGlobal.ts`
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/chapterRevisionLoop.ts`
- Modify: `src/cli/help.ts`
- Test: `tests/e2e/codexTextProviderPipeline.test.ts`
- Test: `tests/e2e/codexTextProviderSafetyGate.test.ts`

- [ ] **Step 1: Write failing e2e tests** for `build-bible`, `plan-global`, `chapter --dry-run`, `chapter --until draft`, and `chapter --commit` blocked.
- [ ] **Step 2: Verify RED** with the new e2e tests.
- [ ] **Step 3: Route provider options** through `ProviderFactory.create({ provider: 'codex-text', codexBin, projectsRoot, projectId, runId })`.
- [ ] **Step 4: Add safety gate**: any state mutation path with `provider=codex-text` throws `CODEX_TEXT_COMMIT_BLOCKED` before commit artifacts or Story State writes.
- [ ] **Step 5: Verify GREEN** with e2e tests.

### Task 5: Provenance, Redaction, Docs, Verification

**Files:**
- Modify: `src/logging/RunLogger.ts`
- Modify: `src/app/artifactIndex.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `tests/e2e/codexTextProviderProvenance.test.ts`
- Test: `tests/e2e/codexTextProviderRedaction.test.ts`

- [ ] **Step 1: Write failing tests** for provider provenance, artifact lineage, prompt redaction mode, and audit strict.
- [ ] **Step 2: Verify RED** with provenance/redaction tests.
- [ ] **Step 3: Record provider fields** in prompt calls and run artifacts, including raw/final/parsed paths and schema validity.
- [ ] **Step 4: Update docs** with M22 commands and safety model.
- [ ] **Step 5: Run final verification**: `corepack pnpm build`, `corepack pnpm test`, CodexTextProvider demo when local Codex is available, and regular mock three-chapter regression.

### Spec Coverage Check

- Provider interface and capabilities: Tasks 1-2.
- Registry list/inspect and health distinction: Task 1.
- Text/JSON generation and errors: Task 2.
- Output schemas: Task 3.
- Pipeline integration: Task 4.
- Commit/state safety: Task 4.
- Provenance, event log, artifact lineage, redaction: Task 5.
- Docs and demo commands: Task 5.
