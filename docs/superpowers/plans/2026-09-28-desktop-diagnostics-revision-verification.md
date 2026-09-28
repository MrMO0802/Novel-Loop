# Diagnostics Revision Verification

Status: Implemented and verified on 2026-09-28; prepared for Git finalization.

## Implemented Flow

Failed submission diagnostics -> explicit AI generation -> isolated candidate
comparison -> explicit whole-candidate adopt/reject -> new submission check ->
existing separately confirmed local commit, only if the new check passes.

Manual editing remains available. Candidate generation, rejection and adoption
do not write the original draft, queue, Story State, canonical final/patch,
commit report or snapshots. Adoption creates a selected author draft through
the existing adoption journal; it is not formal chapter submission.

## Plan Execution Notes

- Source, generation, adoption and audit tests share one integration fixture in
  `tests/integration/desktopDiagnosticRevision.test.ts`.
- Electron scenarios extend the existing submission test file, which is already
  included by `test:e2e:required`.
- Failed diagnostic checks already persist `source_evidence.json`; the reader
  now verifies that historical evidence instead of reconstructing it from live
  files. Legacy evidence without that binding cannot authorize generation.
- The optional author-record preparation callback binds a candidate to a
  reserved revision ID before publication. Completed adoption can be reconciled;
  ambiguous partial adoption blocks rather than creating another revision.
- Preload has no Zod runtime dependency. Strict DTO validation stays in main.
- Electron boundary tests explicitly enumerate the new six-method revision API;
  existing Node-access, sandbox and navigation-denial assertions remain intact.
- Some coverage was added after implementation. Focused RED/GREEN evidence was
  observed for source/generation/adoption work, partial-evidence auditing and
  task polling/publication races; this is not a claim of universal test-first work.

## Review Findings Addressed

- A sandbox preload regression caught a runtime Zod import; replaced it with
  the existing type-only bridge convention.
- Electron exposed a lease race: polling attempted a locked draft read while
  generation was publishing. Owned-task polling now checks registration only;
  mutation and candidate-read admission remain fully validated.
- Terminal task status is not exposed through progress callbacks until the
  generation call has returned and released its lease.
- A newly failed check after adoption can start another candidate instead of
  remaining stuck on the previously adopted candidate.
- Partial failed candidate JSON is schema-checked by audit as well as ready
  candidate evidence.
- Candidate evidence without its publication task now produces an audit error;
  empty directories left before evidence creation remain allowed.
- Exhausted structured-output repair (`CODEX_REPAIR_FAILED`) is classified as
  invalid output instead of an unexpected failure; a focused regression first
  reproduced the incorrect safe code and then passed.
- Legacy character-name placeholders no longer prevent a valid submission
  preview from being displayed. Distinct author-facing labels and a warning
  disclose the missing names without guessing names or modifying the patch.
  Unsafe content and unresolved references remain blocked.
- Preview-reading failures are distinguished from failed prose diagnostics.
  Rereading does not regenerate prose or authorize a commit.

Review was performed inline; no independent reviewer tool was available.
No new provider, workspace-write permission, weakened diagnostic gate,
automatic adoption or automatic commit was introduced.

## Verification Evidence

- Engine build/typecheck: passed.
- Desktop typecheck/build: passed.
- Focused Electron candidate flow: passed, including reject, regeneration,
  restart, adoption, recheck and strict audit.
- Inspected screenshots at 1200x800 and 800x700. The comparison changes from two
  columns to one scrollable column without horizontal overflow.
- Frozen full engine regression: 208 files / 970 tests passed (671.45s).
- Final desktop regression: 48 files / 927 tests passed (62.16s).
- Required Electron suite: 16 passed, no skips (2.4 minutes).
- `git diff --check`: passed.

After the preview-display fix, engine build, desktop typecheck/build, all 931
desktop tests, and two required Electron submission/revision flows passed.
The current registered project's preview was also verified read-only: it used
the adopted draft, and the complete project file hashes remained unchanged.

The initial full engine run found the newly added repair-classification test
against pre-fix loaded code (968 pass / 1 fail); the frozen rerun passed all 970.
The first required Electron run passed 14 tests and failed two old API-surface
assertions. After explicitly enumerating the new six-method API, all 16 passed.
No production code changed during the final desktop/Electron verification.

## Limitations

- Verification uses temporary projects and fake Codex. No real Codex quality,
  latency or quota claim is made, and no registered author project was modified.
- Whole-candidate adoption only. Paragraph diff uses positions, not semantic
  alignment; insertions can make following positions appear changed.
- Cancellation prevents publication of a late response; it does not guarantee
  immediate termination of a provider subprocess already running.
- A candidate is not proof that reported issues are fixed. New diagnostics and
  separate human submission confirmation remain mandatory.
- Ambiguous interrupted adoption requires recovery, not automatic replay.
- Packaging and real-provider execution were not part of this verification.

## Rollback

Hide the new diagnostics-revision entry point while retaining existing candidate
evidence. Manual editing and the prior guarded submission workflow remain usable.
