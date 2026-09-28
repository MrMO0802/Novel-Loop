# Desktop Diagnostics-Assisted Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors generate, compare, explicitly adopt or reject an AI revision after a failed submission check, then recheck before any formal commit.

**Architecture:** Add an isolated diagnostic-revision service through the existing typed preload/main/engine boundary. Reuse verified diagnostic evidence, Codex read-only execution, FileStore, author adoption, and submission guards; never invoke the full chapter revision loop. Candidates remain separate from author revisions until explicit adoption.

**Tech Stack:** Existing TypeScript, Zod, Node, Electron, React, Vitest, Playwright, pnpm; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-desktop-diagnostics-revision-design.md` (approved).

## Execution Status

- [x] Task 1: schemas and verified diagnostic source binding implemented.
- [x] Task 2: isolated generation, cancellation, persisted recovery and evidence audit implemented.
- [x] Task 3: explicit adoption/rejection and completed-adoption retry safety implemented.
- [x] Task 4: typed desktop boundary, registration/editor guards and safe progress polling implemented.
- [x] Task 5: UI/docs, full engine/desktop regression and required Electron scenarios verified.

The original detailed steps below remain the design checklist, not retrospective
claims that every suggested test-first checkpoint or commit was executed.
See `2026-09-28-desktop-diagnostics-revision-verification.md` for actual evidence.

## Global Constraints

- No automatic commit, automatic acceptance, relaxed quality thresholds, real provider benchmark, novel content modification during development, partial paragraph acceptance, full application redesign, or repository push.
- Renderer -> typed preload -> main application service -> engine facade.
- Define Zod schemas under `src/schemas/` before writing any new JSON artifact.
- No shell, workspace-write, new providers, automatic conflict repair, historical recommit, or formal state updates are introduced.
- Whole-candidate adoption/rejection only; preserve all original draft/diagnostic bytes, queue, Story State, snapshots, and canonical artifacts.
- Tests use temporary projects and fake Codex, not the registered author project or real credentials.
- Preserve the three pre-existing dirty files from the earlier pending-alternative fix. Do not revert, silently stage, or mix them into a feature commit. Commit suggestions below are checkpoints, not permission to push or commit unrelated changes.

## Review Focus

- Identical text with a different adopted revision or changed mission must not make stale diagnostics current (Task 1).
- A provider finishes after cancellation or an editor save; its result must not become adoptable (Tasks 2 and 4).
- Crash after author adoption but before disposition persistence must not create a second revision on retry (Task 3).
- Unicode, blank paragraphs, and unsafe Markdown must preserve exact text and remain safely rendered (Tasks 2 and 5).
- Switching project/route while polling must not show or adopt another project's candidate (Tasks 4 and 5).

## File Structure And Interfaces

New focused engine modules:

- `src/schemas/desktopDiagnosticRevision.ts`: output, binding, candidate, task, disposition schemas and inferred types.
- `src/app/desktopDiagnosticRevisionSource.ts`: diagnostics eligibility and freshness.
- `src/app/desktopDiagnosticRevision.ts`: generation, task persistence, safe reads/cancellation.
- `src/app/desktopDiagnosticRevisionAdoption.ts`: adopt/reject and interrupted disposition reconciliation.
- `src/app/desktopDiagnosticRevisionAudit.ts`: validate stored revision evidence without treating historical staleness as corruption.
- `src/desktop/chapterDiagnosticRevision.ts`: desktop facade; export through `src/desktop/index.ts`.

New desktop modules:

- `apps/desktop/src/shared/diagnosticRevisionContract.ts`: strict author-safe IPC DTOs.
- `apps/desktop/src/main/submission/EngineDiagnosticRevisionGateway.ts`: trusted facade adapter.
- `apps/desktop/src/main/submission/ProjectDiagnosticRevisionService.ts`: registration, editor guard, task lifecycle, safe projections.
- `apps/desktop/src/main/ipc/registerDiagnosticRevisionHandlers.ts`: sender validation and request/result parsing.
- `apps/desktop/src/renderer/src/features/submission/DiagnosticRevisionView.tsx`: progress, comparison, decisions.

Shared engine signatures (types defined in schema/service modules above):

```ts
type DiagnosticRevisionScope = { projectRoot: string; chapterNumber: number };
type DiagnosticRevisionSourceInput = DiagnosticRevisionScope & { diagnosticTaskId: string };
type DiagnosticRevisionIdentity = DiagnosticRevisionScope & { candidateId: string };
type DiagnosticRevisionTaskInput = DiagnosticRevisionScope & { taskId: string };
// Candidate/task identifiers are random opaque IDs resolved by trusted readers.
captureDiagnosticRevisionSource(input: DiagnosticRevisionSourceInput): Promise<DiagnosticRevisionBinding>;
assertDiagnosticRevisionSourceFresh(input: DiagnosticRevisionScope, binding: DiagnosticRevisionBinding): Promise<void>;
generateDiagnosticRevision(input: DiagnosticRevisionSourceInput & { taskId: string }, options: DiagnosticRevisionRunOptions): Promise<DiagnosticRevisionTask>;
readDiagnosticRevisionTask(input: DiagnosticRevisionTaskInput): Promise<DiagnosticRevisionTask | null>;
readDiagnosticRevisionCandidate(input: DiagnosticRevisionIdentity): Promise<DiagnosticRevisionReadResult>;
cancelDiagnosticRevision(input: DiagnosticRevisionTaskInput): Promise<DiagnosticRevisionTask>;
adoptDiagnosticRevision(input: DiagnosticRevisionIdentity): Promise<DiagnosticRevisionAdoptionResult>;
rejectDiagnosticRevision(input: DiagnosticRevisionIdentity): Promise<DiagnosticRevisionDisposition>;
```

`DiagnosticRevisionRunOptions` contains existing trusted Codex provider options,
optional injected `LLMClient` for tests, `shouldCancel(): boolean`, and
`onProgress(task: DiagnosticRevisionTask): Promise<void>`; none are renderer inputs.
`DiagnosticRevisionReadResult` holds binding/candidate/disposition, exact source
and candidate text, and freshness eligibility. `DiagnosticRevisionAdoptionResult`
holds candidateId, author revision ID/hash, and `alreadyAdopted: boolean`.

## Task 1: Schemas And Diagnostic Freshness

**Files:** Create schema/source modules above and `tests/unit/desktopDiagnosticRevisionSchemas.test.ts`, `tests/integration/desktopDiagnosticRevisionSource.test.ts`; modify `src/schemas/index.ts` and `src/app/desktopSubmissionDiagnostics.ts`.

**Interfaces:** Produce all persisted types and the two source functions above. Extend the diagnostic reader with an optional verified source binding; missing legacy evidence remains readable but cannot authorize AI generation.

- [ ] Write failing schema tests: reject traversal, scope/hash mismatches, negative/end-before-start durations, adopted without author revision reference, ready without candidate, and unknown keys. Accept a complete fixture for each schema.
- [ ] Define strict schemas. Reuse `DesktopSubmissionSourceSchema` inside binding alongside diagnostic task/run/path/hash and capture time. Candidate output is `{ markdown, changes: [{ issueIndex, reason }] }`; require nonempty Markdown <=2 MiB UTF-8, bounded explanations (1-100 items, reason <=2000 characters), valid diagnostic issue indexes, and no unrecognized fields. Persist task stages `checking_source | generating_revision | validating_candidate`, statuses `running | cancel_requested | cancelled | failed | blocked | ready | interrupted`, disposition `pending | adopting | adopted | rejected | stale`.
- [ ] Write integration tests: current evidence accepted; same text/new adopted revision rejected; changed state/queue/config/mission/plan, missing legacy binding, tampered run/artifact hash, committed chapter, and symlink escape rejected. Assert zero provider calls and unchanged source files.
- [ ] Run `corepack pnpm exec vitest run tests/unit/desktopDiagnosticRevisionSchemas.test.ts tests/integration/desktopDiagnosticRevisionSource.test.ts --maxWorkers=2`; confirm failure before implementing readers.
- [ ] Extend the existing provenance-verifying diagnostics reader to load/hash/parse `source_evidence.json` from the same recorded preview. Implement capture/assert functions using `captureSubmissionSource` and `assertSubmissionSourceFresh`; do not reconstruct missing historical context from current files.
- [ ] Rerun the focused command and existing `tests/integration/desktopSubmissionDiagnostics.test.ts`; require PASS. Suggested checkpoint: `feat: bind diagnostic revisions to verified submission evidence`.

## Task 2: Isolated Generation And Evidence Audit

**Files:** Create generation/audit modules above, `prompts/revision/desktop_diagnostic_revision.md`, `schemas/codex-output/slim/revision.desktop_diagnostic_revision.slim.schema.json`, and `tests/integration/desktopDiagnosticRevision.test.ts`; modify `src/providers/codex/schemas.ts`, `src/providers/codex/promptStageMapping.ts`, `src/app/projectAudit.ts`, and existing artifact schema registration where required.

**Interfaces:** Consume Task 1 binding; produce generate/read/cancel functions above and `auditDesktopDiagnosticRevisions(paths: ProjectPaths, store: FileStore): Promise<AuditIssue[]>`.

- [ ] Write failing tests for valid candidate, invalid/oversized output, invalid issue indexes, cancellation before/during/after response, source change during response, interrupted restart, and version allocation races. Snapshot canonical and authored files; they must be byte-identical after every outcome.
- [ ] Run `corepack pnpm exec vitest run tests/integration/desktopDiagnosticRevision.test.ts --maxWorkers=2`; confirm FAIL.
- [ ] Register prompt ID `revision.desktop_diagnostic_revision` and its output schema. Use the exact checked draft and verified issues/context; treat supplied text as data. Preserve plot/character goals/title, revise reported inconsistencies, return candidate and reasons only. Do not truncate the checked source silently; block oversized required context clearly.
- [ ] Implement versioned `diagnostic_revisions/revision_vN` allocation, schema-validated FileStore writes, run/event provenance and hash checks. Publication must recheck source and persisted cancellation under the project lease. Persist candidate/task completion last; partial writes cannot publish an adoptable result. No ready author-revision records at this stage.
- [ ] Test preservation of Chinese/CRLF/blank-paragraph text and unchanged headings. Cancellation marks task terminal even if the subprocess cannot stop immediately; late completion cannot publish. Restart converts abandoned active tasks to interrupted through the trusted task service, without AI retry.
- [ ] Add audit tests for schema/hash/scope errors and missing published files; valid partial failed runs and old stale evidence must not falsely fail strict audit. Wire evidence audit and artifact recognition using existing audit patterns; never rewrite source data as an audit fix.
- [ ] Rerun focused tests and build. Suggested checkpoint: `feat: generate isolated diagnostics revision candidates`.

## Task 3: Explicit Adoption And Retry Safety

**Files:** Create adoption module/facade above and `tests/integration/desktopDiagnosticRevisionAdoption.test.ts`; modify `src/desktop/chapterAuthoring.ts`, `src/app/chapterAuthorRevision.ts`, and schemas only to add narrowly scoped optional adoption provenance; export facade.

**Interfaces:** Consume verified read result; produce adopt/reject functions above. A stable candidate-to-author-revision binding must be persisted before author adoption starts.

- [ ] Write failing tests for exact-byte adoption, reject, stale/tampered candidate, missing evidence, duplicate adoption, and restart at each persistence boundary. Include two different candidates with identical text; hash equality alone must not reconcile them.
- [ ] Run `corepack pnpm exec vitest run tests/integration/desktopDiagnosticRevisionAdoption.test.ts --maxWorkers=2`; confirm FAIL.
- [ ] Add a narrow diagnostic-candidate provenance option to author adoption, retaining existing manual caller defaults. Record candidateId, source binding hash and planned author revision ID in disposition before publishing; create `mode=codex_adjustment` draft record without broadening mission/plan publication tokens. Reuse author-adoption journal and lease, not formal commit journal or snapshots.
- [ ] On retry, verify bound author record/journal and exact candidate bytes before returning `alreadyAdopted=true`. If adoption never finished, use existing author-adoption recovery rules; ambiguous/incomplete evidence blocks safely instead of inventing a second adoption or altering Story State.
- [ ] Reject only pending candidates; adoption and rejection serialize under the guard/lease. Rejection leaves no pending author record. Publish freshness checks before adoption; after successful adoption, do not misclassify the expected source change as a failed adoption.
- [ ] Test that old submission preview confirmation is rejected after adoption and a new check uses candidate bytes. Recheck hard failure still blocks commit. Require no provider calls on adopt/reject and no changes to queue/state/final/patch/snapshots.
- [ ] Rerun tests including existing desktop submission preview suite. Suggested checkpoint: `feat: safely adopt or reject diagnostic revision candidates`.

## Task 4: Typed Desktop Task Boundary

**Files:** Create shared contract/gateway/service/IPC modules above; modify `apps/desktop/src/shared/desktopApi.ts`, `apps/desktop/src/shared/ipcChannels.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`; create `apps/desktop/tests/shared/diagnosticRevisionContract.test.ts`, `apps/desktop/tests/main/projectDiagnosticRevisionService.test.ts`, `apps/desktop/tests/main/diagnosticRevisionHandlers.test.ts`.

**Interfaces:** `desktopApi.diagnosticRevision` exposes `start({projectKey, diagnosticTaskId})`, `get({projectKey, taskId})`, `cancel({projectKey, taskId})`, `read({projectKey, candidateId})`, `adopt({projectKey, candidateId})`, `reject({projectKey, candidateId})`. Each returns a strict success/error union with author-safe DTOs. Main derives chapter and root from verified tasks/registration, never request paths. Read DTO includes text, reasons, disposition and `canAdopt`, not internal hashes/paths/provider payloads.

- [ ] Write failing contract/IPC tests for unknown keys, path injection, invalid sender and cross-project IDs. Service tests cover unadopted work copies, recovery-required projects, concurrent save/adopt/generation, double start, and late callbacks after project switches.
- [ ] Run `corepack pnpm --dir apps/desktop exec vitest run tests/shared/diagnosticRevisionContract.test.ts tests/main/projectDiagnosticRevisionService.test.ts tests/main/diagnosticRevisionHandlers.test.ts --maxWorkers=2`; confirm FAIL.
- [ ] Implement adapters with existing registration, provider discovery, working-copy checks and shared `ProjectSubmissionGuard`. Release the short main lock during provider work; reacquire before publication/decisions. Engine facade independently revalidates project source under lease.
- [ ] Restore persisted task/candidate status on application restart without automatic provider calls. Redact errors with existing safe-code conventions. Repeated adoption returns completion instead of pending-working-copy error.
- [ ] Rerun tests and `corepack pnpm --dir apps/desktop check`. Suggested checkpoint: `feat(desktop): expose guarded diagnostic revision actions`.

## Task 5: Author UI And End-to-End Delivery

**Files:** Create revision view above and `apps/desktop/tests/renderer/diagnosticRevision.test.tsx`, `apps/desktop/tests/e2e/electron-diagnostic-revision.test.ts`; modify `ChapterSubmissionView.tsx`, `ChapterRevisionCompare.tsx`, `submission.css`, `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`, root/desktop README, and required Electron test selection if explicitly enumerated.

**Interfaces:** Consume Task 4 API; parent refreshes current adopted draft on successful adoption before displaying `重新检查`. Existing manual modification and submission actions remain available.

- [ ] Write failing renderer tests: verified failure shows `让 AI 根据检查结果修订`; transient provider failure does not. Verify phase/cancel, paragraph diff, escaped unsafe Markdown, reason labels, explicit adoption confirmation, reject, leave-and-return, and stale-source explanation.
- [ ] Add tests for double click, autosave race, changed project during pending responses, focus after adoption/error and keyboard operation. Buttons disable while pending; no route update from an obsolete request. After successful adoption, editor must show exact candidate and no false unsaved-change banner.
- [ ] Run `corepack pnpm --dir apps/desktop exec vitest run tests/renderer/diagnosticRevision.test.tsx --maxWorkers=2`; confirm FAIL.
- [ ] Implement Chinese copy and existing layout/icon styles. Reuse safe Markdown and compare behavior, adding draft labels without changing mission/plan defaults. Show reasons as AI suggestions; never label a candidate fixed before fresh diagnostics. Adopt/reject operate on the whole candidate only.
- [ ] Add fake Codex Electron scenarios using temporary registered projects: failed check -> generate -> compare -> adopt -> fresh check; reject/cancel/stale/invalid-output/restart/duplicate adoption. Assert call count (none on decisions), original and state/queue hashes, and no final/patch/snapshot. Confirm required test runner includes these cases.
- [ ] Run the full verification sequence below sequentially. Inspect desktop screenshots at normal and narrow window widths for clipping, scrolling, diff alignment, button states and errors. No user's current application/process is terminated.
- [ ] Update README with the actual new workflow, explicit AI invocation/data sharing, manual fallback and limitations. Suggested checkpoint: `feat(desktop): add diagnostics-assisted draft revision review`.

## Final Verification And Handoff

- [x] `corepack pnpm build`
- [x] `corepack pnpm check`
- [x] `corepack pnpm --dir apps/desktop check`
- [x] `corepack pnpm test --maxWorkers=2 --reporter=dot`
- [x] `corepack pnpm --dir apps/desktop test --maxWorkers=2`
- [x] `corepack pnpm desktop:build`
- [x] `corepack pnpm --dir apps/desktop test:e2e:required`
- [x] `git diff --check`
- [x] Review final diff for unexpected state/queue/commit writers, weakened hard checks, secret exposure, and changed old dirty files. Report exact test results and any skipped checks; do not claim a real Codex run from fake regression evidence.

Run suites sequentially with bounded workers. Do not clean the user's demo or
real novel as part of verification. For feature rollback, hide the new entry
point and retain stored evidence; manual editing/submission must still work.

## Plan Self-Review

- Source freshness and legacy evidence: Task 1.
- Isolated artifacts, cancellation, logging, schema and audit: Task 2.
- Adoption, rejection, crash reconciliation and recheck gate: Task 3.
- Typed API, work-copy guard, recovery and redaction: Task 4.
- Comparison, route safety, accessible states, Electron regression and docs: Task 5.
- All five Review Focus conditions have explicit owning tests. No dependencies,
  real provider runs, production novel edits, or unrelated refactors are planned.

Status: User selected inline execution. Tasks 1-5 are implemented and verified.
Source/generation/adoption tests are consolidated
in `tests/integration/desktopDiagnosticRevision.test.ts`; the Electron scenario
is in `apps/desktop/tests/e2e/electron-submission.test.ts` so it is included in
the existing required suite. Detailed evidence and remaining limitations are
recorded in the implementation verification report rather than marking
unexecuted test-first steps complete retroactively.
