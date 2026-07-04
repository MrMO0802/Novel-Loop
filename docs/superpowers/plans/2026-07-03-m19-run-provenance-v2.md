# M19 Run Provenance v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade run manifests from summary records into schema-versioned provenance records with append-only event logs, artifact lineage, queue/state/prompt provenance, and browser/audit/index integration.

**Architecture:** Keep the existing CLI and pipeline boundaries, but replace direct v1 `RunLogger` behavior with a v2-compatible recorder that still accepts old call sites. Use `RunManifestSchema` as a union-compatible parser for legacy and v2 manifests, write all new runs as `schemaVersion: "2"`, and let browser/audit/index prefer v2 fields while gracefully handling legacy data.

**Tech Stack:** TypeScript, Node.js 20, Zod, Vitest, Commander, existing FileStore/ProjectPaths/RunLogger patterns.

---

### Task 1: Schema and Recorder Contracts

**Files:**
- Modify: `src/schemas/runManifest.ts`
- Create: `src/app/provenanceRecorder.ts`
- Create: `src/app/runContext.ts`
- Test: `tests/e2e/runManifestV2.test.ts`
- Test: `tests/e2e/runEventLog.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that initialize and commit chapter 1, then assert `runs/<runId>/run_manifest.json` contains `schemaVersion: "2"`, `summary`, `resolvedContext`, `artifacts[]`, and `events.ndjson` contains ordered `RUN_STARTED`, `STAGE_*`, `ARTIFACT_GENERATED`, `PROMPT_CALL_*`, `QUEUE_TRANSITION`, `STATE_MUTATION_APPLIED`, `SNAPSHOT_CREATED`, `RUN_COMPLETED` events.

- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
corepack pnpm test tests/e2e/runManifestV2.test.ts tests/e2e/runEventLog.test.ts
```

Expected: fail because v2 fields and event log do not exist.

- [ ] **Step 3: Implement v2 schemas and recorder**

Define `RunManifestV2Schema`, `RunEventSchema`, lineage records, queue transitions, state mutations, prompt calls, snapshots, archives, conflicts, repairs, recommits, historical rebases, reuse policies, redaction policy, and summary schema. Implement append-only `events.ndjson`, `startRun`, `endRun`, `failRun`, `startStage`, `completeStage`, `recordGeneratedArtifact`, `recordReusedArtifact`, `recordArchivedArtifact`, `recordQueueTransition`, `recordStateMutation`, `recordSnapshot`, `recordPromptCall`, `recordReusePolicy`, `recordError`.

- [ ] **Step 4: Make `RunLogger` write v2 and retain legacy read support**

Keep existing `recordArtifact`, `recordLlmCall`, and `endRun` APIs, but have them write v2 artifacts/events/promptCalls/summary fields. Parse old manifests as legacy without crashing.

### Task 2: Pipeline Provenance Integration

**Files:**
- Modify: `src/logging/RunLogger.ts`
- Modify: `src/llm/TelemetryLLMClient.ts`
- Modify: `src/logging/PromptArtifactWriter.ts`
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Modify: `src/app/chapterRevisionLoop.ts`
- Modify: `src/app/chapterCommit.ts`
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/recommitChapter.ts`
- Test: `tests/e2e/artifactLineage.test.ts`
- Test: `tests/e2e/queueTransitionProvenance.test.ts`
- Test: `tests/e2e/stateMutationProvenance.test.ts`
- Test: `tests/e2e/promptProvenanceRedaction.test.ts`

- [ ] **Step 1: Write failing tests**

Assert generated artifacts include real `sha256/sizeBytes`, reused artifacts use `action: "reused"` with source path/reason, archived artifacts include `archiveManifestPath`, queue transitions include before/after, state mutations include patch/snapshot/hash, prompt calls include input/output artifact hashes and redaction metadata.

- [ ] **Step 2: Run tests and verify failures**

Run targeted tests and confirm failures are due missing provenance.

- [ ] **Step 3: Instrument key paths**

Add stage events around planning/drafting/revision/commit, record queue transition deltas after queue mutations, record commit state mutations after snapshots and state writes, record archive/reuse policy data during stale regeneration, and record prompt call hashes from telemetry/prompt artifacts.

### Task 3: Browser, Index, Audit

**Files:**
- Modify: `src/app/runBrowser.ts`
- Modify: `src/cli/commands/run.ts`
- Modify: `src/app/artifactIndex.ts`
- Modify: `src/app/projectAudit.ts`
- Test: `tests/e2e/runBrowserV2.test.ts`
- Test: `tests/e2e/provenanceAudit.test.ts`
- Test: `tests/e2e/legacyRunCompatibility.test.ts`

- [ ] **Step 1: Write failing tests**

Assert `run --events`, `run --artifacts`, `run --state`, and `run --json` work for v2 and legacy manifests. Assert `artifacts --refresh` absorbs v2 lineage, and audit detects artifact hash mismatch and events summary mismatch without crashing on legacy runs.

- [ ] **Step 2: Implement browser/index/audit integrations**

Read `events.ndjson`, expose timelines, summarize artifact/state/queue provenance, mark orphan artifacts from filesystem, validate v2 manifests and event logs, compare summary counts against manifest arrays/events, verify lineage hashes and mutation snapshots.

### Task 4: Docs and Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update docs**

Document Run Manifest v2, event log, artifact lineage, queue/state/prompt provenance, redaction policy, legacy behavior, browser options, and audit checks.

- [ ] **Step 2: Full verification**

Run:

```bash
corepack pnpm build
corepack pnpm test
```

Then run the required regular three-chapter demo, historical recommit + stale regeneration demo, and provenance browser/audit demo.

---

### Self-Review

- Spec coverage: The plan maps each M19 section to schema/recorder, pipeline integration, browser/index/audit, legacy, docs, and verification tasks.
- Placeholder scan: No task is left as TBD; each task names files, behavior, and commands.
- Type consistency: Record names match the M19 spec and existing TypeScript module names.
