# M20 Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M19 mock baseline into a long-running release candidate with stress fixtures, retention, provenance compaction, faster index/audit behavior, clean scripts, and release checklist documentation.

**Architecture:** Keep the chapter pipeline unchanged and add project-maintenance services around it. Stress fixtures generate deterministic large local project structures without provider calls. Retention and compaction produce reports first and only mutate run/event/archive provenance when explicitly applied.

**Tech Stack:** TypeScript, Node.js 20, Commander, Zod, Vitest, existing FileStore/ProjectPaths/RunLogger patterns.

---

### Task 1: Stress Fixtures

**Files:**
- Create: `src/app/stressFixture.ts`
- Create: `src/cli/commands/stressFixture.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/e2e/stressFixture.test.ts`

- [ ] **Step 1: Write the failing test**

Test `createStressFixture({ projectId, chapters: 30 })` and assert it writes config, Story State, chapter queue, 30 chapter directories, run manifests/events, snapshots, and artifact index compatibility.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/stressFixture.test.ts`. Expected failure: module/command missing.

- [ ] **Step 3: Implement deterministic stress fixture**

Generate deterministic committed chapters up to N with compact JSON/Markdown artifacts, v2 run manifests, events, snapshots, and queue. Do not call provider.

### Task 2: Retention And Compaction

**Files:**
- Modify: `src/schemas/observability.ts`
- Create: `src/app/retention.ts`
- Create: `src/app/provenanceCompaction.ts`
- Create: `src/cli/commands/retention.ts`
- Create: `src/cli/commands/compactProvenance.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/e2e/retentionCompaction.test.ts`

- [ ] **Step 1: Write failing tests**

Assert retention preview reports old runs/archives without mutation, apply writes a retention report and preserves latest run manifests, and compaction writes a compacted summary plus replaces oversized event logs with a compacted event log marker.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/retentionCompaction.test.ts`. Expected failure: schemas/services missing.

- [ ] **Step 3: Implement minimal safe retention**

Support `dryRun` default and `apply: true`. Keep newest N runs and newest N archives per chapter. Move retired runs to `runs_retained/` instead of deleting. Never mutate Story State.

- [ ] **Step 4: Implement provenance compaction**

Write `audit/provenance_compaction_vN.json` and `.md`; if applied, write `events.compacted.ndjson` with summary events and keep original manifest.

### Task 3: Index And Audit Performance

**Files:**
- Modify: `src/app/artifactIndex.ts`
- Modify: `src/app/projectAudit.ts`
- Test: `tests/e2e/releaseHardeningPerformance.test.ts`

- [ ] **Step 1: Write failing tests**

Create a 30-chapter stress fixture, run `refreshArtifactIndex` and `auditProject --fixIndex`, assert reports include performance metadata and finish without issues.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/releaseHardeningPerformance.test.ts`. Expected failure: performance metadata missing.

- [ ] **Step 3: Implement performance metadata**

Add scan duration and counts to artifact index and audit report schemas. Batch hash reads and remove O(runs^2) lineage supersession checks by precomputing latest writer by path.

### Task 4: Clean Scripts And Release Checklist

**Files:**
- Create: `scripts/clean-generated.mjs`
- Create: `docs/release/M20_RELEASE_CHECKLIST.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `tests/unit/examples/demoAssets.test.ts`
- Test: `tests/e2e/releaseChecklist.test.ts`

- [ ] **Step 1: Write failing tests**

Assert package scripts exist, clean script accepts demo/test/generated targets, and release checklist contains required build/test/audit commands.

- [ ] **Step 2: Verify RED**

Run `corepack pnpm test tests/e2e/releaseChecklist.test.ts tests/unit/examples/demoAssets.test.ts`. Expected failure: files/scripts missing.

- [ ] **Step 3: Implement docs and scripts**

Add `clean:demo`, `clean:test`, `clean:generated`, `release:checklist`, README release candidate usage, and CHANGELOG `v1.8.0-release-hardening-mock`.

### Task 5: Full Verification

- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run requested CLI commands against `demo-novel`.
- [ ] Report actual command outputs and limitations.

---

### Self-Review

- Spec coverage: stress fixtures, retention, compaction, index/audit performance, clean scripts, release checklist, README, CHANGELOG, and final verification are mapped to tasks.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: New service names match CLI/test names and existing TypeScript module style.
