# M18 Audit Archive Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the mock Novel Loop Engine with verifiable archive copies, artifact indexing, run/snapshot browsing, project audit, and explicit stale regeneration reuse policy.

**Architecture:** Keep M17 state protection intact. Add read-only scanner/browser services under `src/app/`, schema-validate every generated JSON artifact, and connect CLI commands without touching real provider or Web UI. Stale regeneration continues to rerun the full pipeline; M18 adds archive copies, hashes, and policy reports before generation.

**Tech Stack:** TypeScript, Node.js 20+, Commander, Zod, Vitest, local filesystem APIs.

---

### Task 1: Failing M18 E2E Tests

**Files:**
- Create: `tests/e2e/fullArchive.test.ts`
- Create: `tests/e2e/artifactIndex.test.ts`
- Create: `tests/e2e/runBrowser.test.ts`
- Create: `tests/e2e/snapshotBrowser.test.ts`
- Create: `tests/e2e/projectAudit.test.ts`
- Create: `tests/e2e/reusePolicy.test.ts`
- Modify: `tests/unit/cli/program.test.ts`

- [ ] Write tests using existing M16/M17 helpers to create a three-chapter project, historical recommit chapter 2, then regenerate stale chapter 3.
- [ ] Assert archive manifest schema, copied artifacts, real sha256 hashes, missing artifacts, and archive hash audit.
- [ ] Assert `artifacts --refresh`, `runs`, `run`, `snapshots`, `snapshot`, `verify-snapshots`, and `audit` service/CLI behavior.
- [ ] Assert reuse policy default and downgrade behavior.
- [ ] Run targeted tests and verify they fail because services/commands are missing.

### Task 2: Schemas And Hash Utilities

**Files:**
- Modify: `src/schemas/humanReview.ts`
- Create: `src/schemas/observability.ts`
- Modify: `src/schemas/index.ts`
- Create: `src/app/fileHash.ts`
- Modify: `src/storage/ProjectPaths.ts`

- [ ] Add `ArchiveManifestSchema` fields required by M18 while accepting M17-compatible fields only where needed by old tests.
- [ ] Add `ArtifactIndexSchema`, `SnapshotAuditReportSchema`, `ProjectAuditReportSchema`, and `ReusePolicyReportSchema`.
- [ ] Export inferred types from `src/schemas/index.ts`.
- [ ] Add `sha256File`, `fileStat`, and JSON-safe relative path helpers.
- [ ] Add project path helpers for `artifacts/`, `audit/`, and versioned artifacts.
- [ ] Run schema/unit tests.

### Task 3: Full Archive And Reuse Policy

**Files:**
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Modify: `src/app/chapterRevisionLoop.ts`
- Modify: `src/cli/commands/chapter.ts`

- [ ] Add `reusePolicy` input with default `reference_only`.
- [ ] Before stale regeneration, copy core old chapter artifacts into `archive/history_edit_<timestamp>/copied_artifacts/`.
- [ ] Hash every copied file and record missing artifacts.
- [ ] Write `reuse_policy_report_vN.json`.
- [ ] Force full generation unless a future policy explicitly allows safe reuse; downgrade `preserve_scene_structure_if_valid` to `reference_only` when structure validity check is false.
- [ ] Print reuse policy and archive counts from CLI.
- [ ] Run archive/reuse tests.

### Task 4: Artifact Index

**Files:**
- Create: `src/app/artifactIndex.ts`
- Create: `src/cli/commands/artifacts.ts`
- Modify: `src/cli/program.ts`

- [ ] Scan known project paths and classify artifact type, phase, chapter, status, schema name, hash, size, timestamps, and provenance.
- [ ] Write `artifacts/artifact_index.json` only when `--refresh` is passed.
- [ ] Support filters by chapter, type, status, and JSON output.
- [ ] Keep command read-only unless refreshing index; never mutate Story State or provider.
- [ ] Run artifact index tests.

### Task 5: Run And Snapshot Browsers

**Files:**
- Create: `src/app/runBrowser.ts`
- Create: `src/app/snapshotBrowser.ts`
- Create: `src/cli/commands/runs.ts`
- Create: `src/cli/commands/run.ts`
- Create: `src/cli/commands/snapshots.ts`
- Create: `src/cli/commands/snapshot.ts`
- Create: `src/cli/commands/verifySnapshots.ts`
- Modify: `src/cli/program.ts`

- [ ] List run manifests with filters and summarize failed/successful runs.
- [ ] Show one run with artifacts, errors, prompt calls, provider args, stage hints, snapshot ids, and redaction-ready flags.
- [ ] List snapshots with chapter/kind filters.
- [ ] Show one snapshot with latestCommittedChapter, hash, size, and schema validity.
- [ ] Verify snapshots and write `audit/snapshot_audit_report_vN.json` plus `.md`.
- [ ] Run browser tests.

### Task 6: Project Audit

**Files:**
- Create: `src/app/projectAudit.ts`
- Create: `src/cli/commands/audit.ts`
- Modify: `src/cli/program.ts`

- [ ] Check config, story state, queue, stale consistency, downstream reports, regeneration plan, historical reports, snapshots, base snapshots, archive manifests, archive hashes, run manifests, key JSON schemas, latest commit reports, canon patches, stale pollution, duplicate artifact ids, and missing artifacts.
- [ ] Write `audit/project_audit_vN.json` and `.md`.
- [ ] Make `--fix-index` only refresh `artifacts/artifact_index.json`.
- [ ] Make `--strict` exit non-zero on error/critical issues.
- [ ] Run project audit tests.

### Task 7: Docs And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document archive model, artifact index, run browser, snapshot browser, verify-snapshots, audit strict/fix-index, and reuse policy.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run the required M18 demo commands from clean `projects/demo-novel`.
- [ ] Summarize outputs and known limitations.
