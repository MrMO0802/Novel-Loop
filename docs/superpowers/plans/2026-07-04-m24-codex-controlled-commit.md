# M24 Codex Controlled Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `provider=codex-text` to perform normal next-chapter controlled commits only after preview, local validation, conflict checks, explicit confirmation, snapshots, and local Story State application.

**Architecture:** Add a Codex-specific controlled commit service instead of opening the existing generic `commitChapterState` path. The service reuses existing local safety primitives (`CanonPatchSchema`, `checkPatchConflicts`, `applyCanonPatchToStoryState`, `SnapshotStore`, `writePatchPreviewDiff`, `RunLogger`) and adds Codex-only artifacts for patch proposal, approval, and commit report.

**Tech Stack:** TypeScript, Node.js 20, Commander, Vitest, Zod, local filesystem stores, existing CodexTextProvider read-only boundary.

---

### Task 1: RED Tests For Preview And Confirm

**Files:**
- Create: `tests/e2e/codexControlledCommitPreview.test.ts`
- Create: `tests/e2e/codexControlledCommitConfirm.test.ts`
- Modify: `tests/helpers/fakeCodex.ts`

- [ ] Write preview test: setup fake Codex project through `buildBible`, `planGlobal`, and `runChapterUntilDraft`; call `runChapterFullProduction({ provider: 'codex-text', commit: true })`; assert `previewOnly=true`, Story State unchanged, no confirmed approval, no `commit_report.json`, queue not committed, diff preview exists.
- [ ] Write confirm test: same setup; call with `confirmCodexCommit: true`; assert `codex_approval_record_v1.json`, `codex_commit_report_v1.json`, before/after snapshots, `latestCommittedChapter=1`, queue committed, and run manifest state mutation `mutationType=codex_controlled_commit`.
- [ ] Run focused tests and verify RED: `corepack pnpm test tests/e2e/codexControlledCommitPreview.test.ts tests/e2e/codexControlledCommitConfirm.test.ts`.

### Task 2: Schemas And Prompt Contracts

**Files:**
- Modify: `src/schemas/humanReview.ts`
- Modify: `src/schemas/commitReport.ts`
- Modify: `src/schemas/runManifest.ts`
- Modify: `src/schemas/observability.ts`
- Modify: `src/schemas/index.ts`
- Add: `schemas/codex-output/slim/revision_plan.slim.schema.json`
- Add: `schemas/codex-output/slim/memory.canon_patch_proposal.slim.schema.json`
- Modify: `src/providers/codex/schemas.ts`
- Add: `prompts/codex-text/revision/create_revision_plan_slim.md`
- Add: `prompts/codex-text/revision/rewrite_chapter.md`
- Add: `prompts/codex-text/revision/final_chapter.md`
- Add: `prompts/codex-text/memory/extract_canon_patch_proposal_slim.md`

- [ ] Extend `ApprovalRecordSchema.action` with `codex_controlled_commit` and optional provider/state diff/patch fields needed by M24.
- [ ] Add `CodexCommitReportSchema` with provider, controlledCommit, confirmed, patch/diff/approval paths, snapshots, conflict/schema flags, committed, latestCommittedChapter before/after.
- [ ] Add `codex_controlled_commit` to `StateMutationRecordSchema.mutationType`.
- [ ] Add event types `CODEX_COMMIT_PREVIEW_CREATED` and `CODEX_COMMIT_APPROVAL_RECORDED`.
- [ ] Register Codex output schemas for revision plan and canon patch proposal.
- [ ] Add prompts that request final-only output and no direct Story State writes.

### Task 3: Codex Controlled Commit Service

**Files:**
- Create: `src/app/codexControlledCommit.ts`
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/chapterRevisionLoop.ts` only if shared types need `confirmCodexCommit`.

- [ ] Implement `runCodexControlledCommit(input)` with preview-only and confirmed modes.
- [ ] Ensure scope: only `provider=codex-text`, normal chapter, no stale regeneration, no historical/recommit path, `chapterNumber = latestCommittedChapter + 1`.
- [ ] Generate diagnostics via `diagnostics.diagnose_chapter_slim`, normalize to `DiagnosticsReportSchema`, and write `diagnostics_vN.json`.
- [ ] If hard diagnostics fail, mark needs human review and do not write state.
- [ ] Generate revision plan via slim schema and write `revision_plan_vN.json`; rewrite draft if needed; write `final.md`.
- [ ] Generate `canon_patch_codex_proposal_vN.json`; validate with `CanonPatchSchema`.
- [ ] Run local conflict checks and write conflict report on hard conflicts.
- [ ] Always write state diff preview.
- [ ] Preview-only returns without Story State mutation or approval.
- [ ] Confirmed mode writes approval, snapshots before/after, applies patch locally, writes `codex_commit_report_vN.json`, updates queue committed, records run manifest artifacts/state mutation/events.

### Task 4: CLI Flags And Safety Error Codes

**Files:**
- Modify: `src/cli/commands/chapter.ts`
- Modify: `src/app/codexTextSafety.ts`
- Modify: `src/app/recommitChapter.ts`
- Modify: `src/cli/commands/recommit.ts` if needed.

- [ ] Add `--confirm-codex-commit` to `chapter`.
- [ ] Pass `confirmCodexCommit` to pipeline service.
- [ ] Keep `commit-chapter` blocked for codex-text.
- [ ] Keep recommit blocked for codex-text with `CODEX_TEXT_RECOMMIT_BLOCKED`.
- [ ] Block stale regeneration commit with codex-text as `CODEX_TEXT_STALE_REGEN_COMMIT_BLOCKED`.

### Task 5: Failure Tests And Provenance Tests

**Files:**
- Create: `tests/e2e/codexControlledCommitSafety.test.ts`
- Create: `tests/e2e/codexControlledCommitProvenance.test.ts`
- Create: `tests/e2e/codexCanonPatchProposal.test.ts`
- Create: `tests/e2e/codexControlledCommitFailure.test.ts`
- Modify: `tests/helpers/fakeCodex.ts`

- [ ] Add fake modes for `codex-controlled-valid`, `codex-controlled-invalid-patch`, `codex-controlled-conflict`, and `codex-controlled-diagnostics-fail`.
- [ ] Test invalid patch schema blocks without Story State change.
- [ ] Test patch conflict writes conflict report and blocks.
- [ ] Test diagnostics hard fail enters human review without Story State change.
- [ ] Test stale regeneration commit, recommit, and historical recommit remain blocked.
- [ ] Test run manifest prompt calls/artifacts/state mutation/events and redaction.

### Task 6: Docs And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document preview-only controlled commit and confirmed controlled commit.
- [ ] Document Codex patch proposal and local apply boundary.
- [ ] Document safety exclusions.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run mock demo through audit.
- [ ] If local Codex is available, run preview-only and confirmed controlled commit demo.

---

## Spec Coverage

- Controlled preview/confirm: Tasks 1, 3, 4.
- Final/diagnostics/revision: Tasks 2, 3.
- Canon patch proposal: Tasks 2, 3, 5.
- State diff preview: Tasks 1, 3.
- Approval and commit reports: Tasks 2, 3.
- Queue/provenance/events: Tasks 3, 5.
- Safety exclusions: Tasks 4, 5.
- Redaction/security: existing boundary plus Task 5.
- Docs/demo: Task 6.
