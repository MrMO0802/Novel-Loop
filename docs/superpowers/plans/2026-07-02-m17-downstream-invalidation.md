# M17 Downstream Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow explicitly confirmed historical recommit to rebase Story State to the edited chapter, mark downstream chapters stale, generate regeneration plans, and regenerate stale chapters safely.

**Architecture:** Keep M16 `recommitChapter` as the entrypoint and add a historical branch that uses a base snapshot instead of live Story State. Add focused services for stale listing and regeneration plans. Extend chapter pipeline only enough to select/archive/regenerate stale chapters.

**Tech Stack:** TypeScript, Node.js 20, Commander, Zod, Vitest, existing FileStore/SnapshotStore/ChapterQueueStore.

---

### Task 1: Tests First

**Files:**
- Create: `tests/e2e/historicalRecommitDownstreamInvalidation.test.ts`
- Create: `tests/e2e/staleCommand.test.ts`
- Create: `tests/e2e/regenerationPlan.test.ts`
- Create: `tests/e2e/regenerateStaleChapter.test.ts`

- [ ] Write tests for default historical block, missing `--mark-downstream-stale`, preview-only, confirmed rebase, stale listing, regeneration plan, and stale regeneration.
- [ ] Run `corepack pnpm test tests/e2e/historicalRecommitDownstreamInvalidation.test.ts tests/e2e/staleCommand.test.ts tests/e2e/regenerationPlan.test.ts tests/e2e/regenerateStaleChapter.test.ts`.
- [ ] Verify RED due to missing M17 services/fields.

### Task 2: Schemas

**Files:**
- Modify: `src/schemas/humanReview.ts`
- Modify: `src/schemas/index.ts`

- [ ] Extend `DownstreamInvalidationReportSchema` with edited chapter, old/new latest, snapshots, invalidated chapter records, regeneration flag, and suggested command.
- [ ] Add `RegenerationPlanSchema` with strategy, reuse policy, stale/blocked chapters, target chapters, and recommended commands.
- [ ] Extend `RecommitReportSchema` with historical rebase metadata.

### Task 3: Historical Recommit

**Files:**
- Modify: `src/app/recommitChapter.ts`

- [ ] Keep default `HISTORICAL_RECOMMIT_BLOCKED`.
- [ ] Add `DOWNSTREAM_STALE_MARK_REQUIRED` when historical is allowed without downstream stale marking.
- [ ] Add preview path that writes diff and downstream invalidation preview without queue/state changes.
- [ ] Add confirmed path that finds base snapshot, applies patch to base state, writes before/after snapshots, writes historical/downstream reports, marks downstream stale, and writes live Story State rebased to edited chapter.

### Task 4: Stale And Regeneration Plan

**Files:**
- Create: `src/app/staleChapters.ts`
- Create: `src/app/regenerationPlan.ts`
- Create: `src/cli/commands/stale.ts`
- Create: `src/cli/commands/regenerationPlan.ts`
- Modify: `src/cli/program.ts`

- [ ] Implement read-only stale listing.
- [ ] Implement regeneration plan JSON/Markdown writer under `planning/`.
- [ ] Wire CLI commands and human-readable output.

### Task 5: Regenerate Stale

**Files:**
- Modify: `src/app/chapterPipeline.ts`
- Modify: `src/app/chapterRevisionLoop.ts`
- Modify: `src/app/chapterCommit.ts`
- Modify: `src/cli/commands/chapter.ts`

- [ ] Add `--regenerate-stale`.
- [ ] Resolve `chapter next --regenerate-stale` to earliest stale chapter.
- [ ] Archive old artifact manifest before regenerating.
- [ ] Force regeneration of planning/draft/revision/patch stages for stale chapter.
- [ ] Commit regenerated stale chapter and leave remaining stale chapters untouched.

### Task 6: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document historical recommit safety, stale command, regeneration plan, and `--regenerate-stale`.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm test`.
- [ ] Run the M17 demo commands from the spec.
