# M21 Codex Execution Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely connect the local Codex CLI as a read-only execution boundary that can produce text/JSON artifacts without mutating Story State.

**Architecture:** Add a dedicated Codex boundary service that owns binary detection, health checks, sandboxed `codex exec`, JSONL capture, output-schema validation, redaction, and run manifest v2 provenance. CLI commands call this service only; no business pipeline directly invokes Codex.

**Tech Stack:** TypeScript, Node.js 20 child_process, Commander, Zod, Vitest, existing FileStore/ProjectPaths/RunLogger infrastructure.

---

### Task 1: Codex Boundary Service And Schemas

**Files:**
- Modify: `src/schemas/observability.ts`
- Modify: `src/schemas/runManifest.ts`
- Modify: `src/schemas/index.ts`
- Create: `src/app/codexBoundary.ts`
- Test: `tests/e2e/codexBoundary.test.ts`

- [ ] **Step 1: Write failing tests**

Use fake local Codex binaries in temp directories to assert missing binary errors, status output, read-only smoke, JSON exec output-schema parsing, redaction, and Story State immutability.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/codexBoundary.test.ts`. Expected: missing module/schema/CLI behavior.

- [ ] **Step 3: Implement boundary**

Implement `checkCodexStatus`, `runCodexSmoke`, `execCodexText`, `execCodexJson`. Default sandbox is `read-only`, `workspaceWriteAllowed=false`, `shellCommandsAllowed=false`, `storyStateCommitAllowed=false`. Never read auth files.

### Task 2: Provenance And Artifacts

**Files:**
- Modify: `src/logging/RunLogger.ts` if needed
- Modify: `src/app/codexBoundary.ts`
- Test: `tests/e2e/codexProvenance.test.ts`

- [ ] **Step 1: Write failing tests**

Assert Codex exec writes run manifest v2, events.ndjson, raw JSONL, final output, parsed JSON, and redacted raw output with no token-like content.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/codexProvenance.test.ts`.

- [ ] **Step 3: Implement provenance**

Record Codex calls as prompt calls and generated artifacts. Write artifacts under `codex/runs/<runId>/`. Use a synthetic project id `codex-boundary` by default, with optional CLI `--project-id`.

### Task 3: CLI Commands

**Files:**
- Create: `src/cli/commands/codex.ts`
- Modify: `src/cli/program.ts`
- Add: `examples/codex_json_prompt.md`
- Add: `examples/codex_output.schema.json`
- Test: `tests/e2e/codexCli.test.ts`
- Test: `tests/unit/cli/program.test.ts`

- [ ] **Step 1: Write failing tests**

Assert `novel-loop codex status`, `smoke`, `exec-text --prompt`, and `exec-json --prompt --schema` are registered and use safe defaults.

- [ ] **Step 2: Implement CLI**

Add command group `codex` with `status`, `smoke`, `exec-text`, and `exec-json`; provide `--codex-bin`, `--root`, and `--project-id` testability options.

### Task 4: Regression And Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: existing mock demo tests

- [ ] **Step 1: Document boundary**

Document local Codex only, no DeepSeek/OpenAI API, read-only sandbox, no Story State commit, output schema, JSONL capture, and redaction.

- [ ] **Step 2: Verify**

Run `corepack pnpm build`, `corepack pnpm test`, and if local Codex is available run the requested Codex CLI commands.

---

### Self-Review

- Spec coverage: binary status, login/health, smoke, JSONL, output schema, provenance, artifacts, read-only sandbox, no workspace write/shell/state commit, auth redaction, tests, docs, and final verification are mapped.
- Placeholder scan: No TODO/TBD placeholders.
- Type consistency: Service names and CLI command names match tests and spec.
