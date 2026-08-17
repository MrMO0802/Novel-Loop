# Task 8 Implementation Report

## Scope

Completed Task 8 and reviewer fix rounds 1-6 for recoverable Chapter Draft
editing on `codex/novel-loop-desktop-prototype`.

- Base implementation: `4763142de0844979bfcde85271271bd6a2ce0b46`
- Fix round 1: `1486154474ee30ebb6bdf00847ea4a1f7050358e`
- Fix round 2: `07cad6426fcb97c3a9867ad4f30f25f741061988`
- Fix round 3: `4806191b669e351c56952e4af107c4d899efd1d0`
- Fix round 5 base: `b5ea893f8055c22f29272238216d0ce0cf8922f2`
- Fix round 6 base: `fd1e379ea7678875117d5278204f523fcab027ae`

The implementation remains inside the approved desktop boundary: no Story
State or chapter-queue mutation, no diagnostics/final/canon-patch/commit work,
and no provider or renderer filesystem expansion.

## Reviewer Finding Closure

### Adoption Tokens And Ordering

- Draft adoption tokens are content-bound, project/chapter-bound, expiring,
  bounded, and revoked whenever a newer working copy is read or saved.
- Adoption now verifies the current review chapter number as well as project,
  source hash, and exact working-copy content. Identical generated prose in a
  different chapter cannot authorize an old token.
- A rollback-failure response retires its token because the durable adoption
  result is uncertain and must be reviewed rather than retried.
- Draft read/save/discard/adopt operations are serialized per project. Renderer
  autosaves are serialized by edit version.
- Electron acquires `app.requestSingleInstanceLock()` before startup. A second
  launch restores, shows, and focuses the primary window; a process that does
  not acquire the lock quits before registering services or opening a window.

### Crash-Recoverable Adoption And Provenance

- Before changing any revision record, adoption writes a schema-validated
  `*_adoption_journal_vN.json` in `prepared` state. The journal contains every
  before record, every intended record, the target identity, and the related
  invalidation-report reference.
- Journal, revision, and terminal journal writes use atomic replacement plus
  file and containing-directory sync. A committed journal is written only
  after every intended revision record is durable.
- In-process failures restore all before records in reverse order and mark the
  journal `recovered_rolled_back`. If compensation fails, the prepared journal
  and invalidation report remain durable for the next recovery pass.
- Author-revision reads and startup publication scans detect prepared journals,
  replay the before records idempotently, and record
  `recoveryReason: read_time_recovery`. A dead lock owner PID is reclaimed
  without waiting for the normal stale-heartbeat interval.
- The subprocess regression sends `SIGKILL` immediately after the old active
  revision is durably superseded. A fresh read restores the old adopted
  revision, marks the transaction recovered, and preserves provenance.

### Round 4 Transaction Confinement And Durability

- Revision IDs, working-copy paths, mutation record paths, journal project,
  chapter, artifact kind, target, and filename are now one canonical identity.
  Recovery derives each destination from that identity and never trusts a
  journal-supplied path as a write destination.
- Before recovery writes any record, it reads every mutation destination and
  requires the current value to equal exactly either `beforeRecord` or
  `intendedRecord`. Missing, malformed, unrelated, or ambiguous records fail
  closed before the first write.
- The malicious journal regression attempts to bind draft recovery to
  `planning/chapter_queue.json`; Story State, chapter queue, generated
  `draft_v1.md`, and an unrelated file remain byte-identical.
- Atomic replacement now distinguishes a post-rename directory-sync failure
  as durability-uncertain. If a committed terminal marker persisted before an
  exception, adoption verifies the marker and intended records and never runs
  compensation. An absent committed marker still follows the prepared
  rollback path.
- Verified terminal journals move out of the active scan into a bounded
  archive. At most eight terminal records are retained; damaged archived
  history cannot block reads, while damaged active/nonterminal recovery data
  remains fail-closed.

### Round 4 Project Lease And Renderer Recovery

- Lease acquisition writes and syncs a complete owner record in a private
  candidate directory before atomically publishing the canonical lock. There
  is no published lock-directory window without owner metadata.
- Owner identity contains both PID and Linux process-start identity. A reused
  PID cannot make a dead owner look live, and a legacy ownerless stale lock is
  repaired after a bounded grace period.
- Stale takeover uses an exclusive transition claim, rechecks owner bytes and
  directory device/inode identity, and renames only that observed directory.
  The deterministic dual-reclaimer test pauses the first takeover while a
  second competes and proves exactly one lease is acquired and a replacement
  live lock cannot be removed.
- Rollback failure, committed-marker durability uncertainty, and ambiguous
  recovery all map to the same redacted renderer recovery boundary and retire
  the uncertain adoption token while retaining invalidation provenance.
- A successful “重新载入本章” performs fresh draft/working-copy reads and
  remounts the editor state. Recovery-required mode blocks autosave, Ctrl+S,
  Ctrl+Shift+P, edit/preview controls, discard, compare, and adoption until that
  reload succeeds.

### Round 5 Save Generations And Recovery Protocol

- Renderer autosave now uses explicit edit generations and one serialized save
  queue. An older queued save cannot switch a newer edit to `saving`, cancel its
  timer, or suppress its persistence. Manual and timed saves of the same
  generation are deduplicated.
- Project lease publication is now a complete regular metadata file published
  with a same-filesystem hard link. The link is the atomic no-replace primitive;
  an existing fresh owner cannot be replaced by `rename` behavior on Linux.
- Lease and transition-claim identity includes PID, process-start identity, and
  Linux boot ID. Missing required Linux identity fails closed, and a matching
  PID/start identity from another boot is not considered live.
- Transition claims are complete regular metadata files published by the same
  no-replace protocol. A contender performs bounded no-follow reads, checks
  claimant age and liveness, and takes over or removes only the exact observed
  inode. A delayed live claimant cannot be stolen.
- Failed lease release or stale takeover removes only its own claim and leaves
  the lease heartbeat active and retryable. Post-publication verification
  failure removes the exact published inode; if cleanup itself cannot rename
  it, the private candidate is used to mark the orphan immediately reclaimable
  rather than leaving a live-PID owner record.
- Owner and claim metadata reads use descriptors with `O_NOFOLLOW` and
  `O_NONBLOCK`, accept regular files only, enforce an 8 KiB cap, and decode UTF-8
  fatally. Symlinks, FIFOs, oversized files, and invalid UTF-8 cannot block or
  redirect recovery.
- Before a terminal adoption journal is archived, every current mutation record
  must match its terminal expectation: `committed` requires the intended value;
  `recovered_rolled_back` requires the before value. A mixed or mismatched disk
  state fails closed and retains the active journal.
- Historical revision and journal filenames are parsed only as bounded canonical
  decimal safe integers. Oversized values, exponent notation, leading zeros, and
  exhausted future versions are ignored or rejected without collision.
- Recovery-required mode moves focus to the recovery action while preserving
  the existing modal keyboard and focus-restoration behavior.

### Round 6 Transition Recovery And Editor Continuity

- Acquisition now inspects the transition-claim path before publishing a new
  owner. A claim whose observed canonical lock is absent or has changed is
  removed by exact inode identity before publication, so a live-PID orphan
  left after a completed rename cannot block the next lease.
- Active claims refresh their inode-bound mtime every five seconds. A valid
  claim whose owner remains alive but makes no heartbeat progress for two
  minutes is recoverable; dead owners remain immediately recoverable. A retry
  by the same lease can resume its exact matching claim after release and claim
  cleanup fail together.
- Exact cleanup first pins the expected inode with a private hard link. It then
  quarantines the canonical path and validates the moved identity. If an ABA
  replacement was moved, restoration uses a no-replace hard link only; it
  never renames over a newer canonical claimant. The same no-overwrite helper
  replaces the old release and stale-takeover restoration branches.
- Working-copy record reads combine `O_NOFOLLOW` and `O_NONBLOCK`, then require
  a regular file and enforce the existing bounded fatal UTF-8 read. A FIFO is
  rejected and quarantined without waiting for a writer.
- Edit and preview modes retain one textarea DOM node. Preview hides the node
  instead of unmounting it, preserving native undo/redo state and selection.
- Continue-recovery, discard-recovery, normal discard, and dialog close set an
  explicit focus intent. A layout effect fulfills the intent only after React
  has removed the gate/dialog and re-enabled the destination control.

### Working-Copy Storage

- Working-copy filesystem operations are anchored to open directory
  descriptors for the complete operation. Child paths use verified
  `/proc/self/fd/<fd>` handles and final files use `O_NOFOLLOW`.
- Directory components cannot redirect an in-flight read, write, discard, or
  quarantine after validation. The deterministic regression test swaps the
  project directory for an external symlink during replacement and verifies
  the external sentinel remains byte-identical.
- Temporary files use unpredictable names, `O_CREAT | O_EXCL | O_NOFOLLOW`,
  mode `0600`, file sync, and atomic rename inside the anchored directory.
- Reads are bounded for the worst-case six-byte JSON escaping expansion, are
  descriptor-based and no-follow, and use fatal UTF-8 decoding. Malformed,
  oversized, non-UTF-8, and symlinked records are rejected or quarantined.
- Serialized record size is checked before replacement. A valid two-MiB
  escape-heavy Markdown working copy can be saved and reopened exactly.
- A child directory handle enters the owned-handle set immediately after open,
  so chmod/stat failures cannot leak a descriptor.
- The current secure primitive is supported for the Ubuntu 24.04 first release.
  Non-Linux platforms, missing procfs, or unavailable no-follow/directory flags
  fail closed with `DRAFT_WORKING_COPY_UNAVAILABLE`; there is no pathname-only
  fallback.

### Renderer And IPC Boundary

- Recovered and stale copies remain gated until explicit continue or durable
  discard. Failed discard leaves the recovery choice active.
- Draft adoption returns a strict discriminated result over IPC. The
  `recovery_required` result survives `ipcRenderer.invoke` structured cloning
  and exposes only the author-safe `reload_chapter` action.
- The editor shows a distinct recovery-required state, disables further edits,
  and offers “重新载入本章”; it does not infer recovery from custom Error
  properties that Electron can discard.
- Dialogs provide initial focus, focus trapping, Escape/cancel, exact focus
  restoration, modal semantics, and accessible labels.
- `versionKind` is required. Preview renders manuscript headings and paragraphs
  rather than one raw Markdown node.
- Renderer-facing responses contain no filesystem paths, hashes, run IDs,
  internal revision IDs, schema names, authentication data, or raw filesystem
  errors.

## Round 2 TDD Evidence

Tests were added and observed RED before each production change:

- Root adoption suite: `2` expected failures proved that a post-write
  supersede exception left the old revision superseded and rollback failure
  deleted its provenance report.
- Desktop service/IPC suite: `3` expected failures proved that same-text
  cross-chapter adoption succeeded and rollback failure was collapsed into
  generic service/IPC errors.
- Single-instance policy initially failed to load because the policy did not
  exist.
- Storage suite: `2` expected failures proved that a component swap overwrote
  an external sentinel and an unavailable descriptor root silently fell back
  to pathname writes.
- The uncertain-adoption token test then failed by allowing a second adoption;
  the token is now retired before the safe recovery classification is returned.

All cases were rerun GREEN after their minimal production changes.

## Round 3 TDD Evidence

The following regressions were added and observed RED before production
changes:

- The journal schema test failed because no durable adoption transaction
  contract existed.
- A real subprocess `SIGKILL` after the supersede write restarted with the
  generated draft rather than a valid author-adopted revision; the first
  recovery attempt also exposed the dead process lock.
- The IPC handler threw an Error with a custom code instead of returning a
  serializable recovery result, and the renderer had no recovery action.
- A valid escape-heavy two-MiB Markdown record was quarantined because JSON
  expansion exceeded the read cap.
- Invalid UTF-8 was decoded as replacement-character prose.
- An injected chmod failure was ignored and proved the newly opened child
  handle was not under immediate ownership.

All round-3 cases now pass, including byte-identical generated draft, Story
State, and chapter queue assertions across the crash/restart boundary.

## Round 4 TDD Evidence

The round-4 regressions were written before production changes and observed
RED:

- The initial root matrix reported `10` failures: canonical-path schema
  binding, forged journal confinement, ambiguous-record rejection,
  committed-marker durability handling, terminal retention, complete lease
  owner identity, ownerless recovery, and deterministic dual-reclaimer
  serialization.
- After the renderer timing assertion was made deterministic, the desktop
  matrix reported `4` failures across recovery error classification, Ctrl+S /
  preview shortcut gating, and workspace editor reinitialization.
- The AtomicWriter fault injection proved rename had completed while directory
  sync threw. The adoption injections proved both a normal and a deliberately
  failing compensation hook were never called after a persisted committed
  marker.
- A follow-up archive fault initially escaped as a generic error after the
  committed marker. It now returns the same durability-uncertain recovery
  boundary, retains provenance, performs zero compensation, and completes
  terminal cleanup on the next read.

The minimal production changes then made the same matrices GREEN.

## Round 5 TDD Evidence

The round-5 regressions were written and observed RED before redesigning the
affected code:

- The deferred autosave A/B/C test showed queued save B setting edit C to
  `saving` and cancelling C's timer. A separate same-generation test observed
  Ctrl+S and autosave issuing two writes, and the recovery-required focus test
  left focus on the document body.
- Both terminal-journal mismatch cases archived inconsistent active journals
  instead of failing closed. Unsafe MAX_SAFE_INTEGER, oversized decimal, and
  exponent-form history filenames also entered version selection or parsing.
- The first lease safety matrix failed all `12` cases under the directory-lock
  protocol, including Linux no-replace, dead-claim recovery, live delayed
  claimants, boot mismatch, symlink, oversized, FIFO, and invalid UTF-8 cases.
- Fault injection initially proved post-link verification failures could leave
  a published orphan, release rename failure could stop ownership prematurely,
  and stale-takeover failure could retain the transition claim. The cleanup
  fallback test then observed the real boot ID remaining on an unremovable
  live-PID orphan before the abandoned identity fallback was added.

The final generation queue, regular-file publication protocol, exact-inode
cleanup, and fail-closed journal/version validation make the same cases GREEN.

## Round 6 TDD Evidence

The round-6 regressions were added before production changes and observed RED:

- The lease fault/safety matrix failed four cases: an expired live-identity
  claim remained permanently live, an absent-lock orphan blocked the next
  release, a claim-cleanup failure poisoned the replacement lease, and the
  old quarantine restoration overwrote the newest deterministic ABA claimant.
- The FIFO working-copy read reached the 500 ms escape writer instead of
  completing independently.
- Preview disconnected the original textarea node, and post-recovery plus
  post-discard focus remained on the document body.
- A release-rename plus claim-cleanup fault also proved that retry could not
  resume the same lease's exact live claim.

The claim lifecycle, no-overwrite quarantine protocol, nonblocking read, stable
textarea, and post-render focus intent made those same cases GREEN.

## Round 6 Changed Files

- `src/app/projectOperationLease.ts`
- `tests/integration/projectOperationLeaseFaults.test.ts`
- `tests/integration/projectOperationLeaseSafety.test.ts`
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- `apps/desktop/tests/main/draftWorkingCopyStore.test.ts`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- `apps/desktop/tests/renderer/chapterDraftEditor.test.tsx`
- This Task 8 implementation report and progress record.

## Round 5 Changed Files

- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- `apps/desktop/tests/renderer/chapterDraftEditor.test.tsx`
- `src/app/chapterAuthorRevision.ts`
- `src/app/projectOperationLease.ts`
- `tests/integration/desktopDraftAdoption.test.ts`
- `tests/integration/projectOperationLease.test.ts`
- `tests/integration/projectOperationLeaseRace.test.ts`
- `tests/integration/projectOperationLeaseFaults.test.ts`
- `tests/integration/projectOperationLeaseSafety.test.ts`
- This Task 8 implementation report.

## Round 4 Changed Files

- `src/schemas/chapterAuthorRevision.ts`
- `src/app/chapterAuthorRevision.ts`
- `src/app/projectOperationLease.ts`
- `src/desktop/chapterAuthoring.ts`
- `src/storage/AtomicWriter.ts`
- `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx`
- `tests/unit/chapterAuthorRevisionSchemas.test.ts`
- `tests/unit/storage/fileInfrastructure.test.ts`
- `tests/integration/desktopDraftAdoption.test.ts`
- `tests/integration/projectOperationLease.test.ts`
- `tests/integration/projectOperationLeaseRace.test.ts`
- `apps/desktop/tests/main/projectChapterService.test.ts`
- `apps/desktop/tests/renderer/chapterDraftEditor.test.tsx`
- `apps/desktop/tests/renderer/chapterWorkspace.test.tsx`
- This Task 8 implementation report and progress record.

## Round 3 Changed Files

- `src/schemas/chapterAuthorRevision.ts`
- `src/schemas/index.ts`
- `src/app/chapterAuthorRevision.ts`
- `src/app/projectOperationLease.ts`
- `src/storage/AtomicWriter.ts`
- `apps/desktop/src/shared/chapterContract.ts`
- `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- `tests/fixtures/crash-draft-adoption.mjs`
- `tests/unit/chapterAuthorRevisionSchemas.test.ts`
- `tests/integration/desktopDraftAdoption.test.ts`
- `apps/desktop/tests/main/chapterContract.test.ts`
- `apps/desktop/tests/main/chapterHandlers.test.ts`
- `apps/desktop/tests/main/draftWorkingCopyStore.test.ts`
- `apps/desktop/tests/preload/preloadBoundary.test.ts`
- `apps/desktop/tests/renderer/chapterDraftEditor.test.tsx`
- This Task 8 implementation report.

## Round 2 Changed Files

- `src/app/chapterAuthorRevision.ts`
- `src/desktop/chapterAuthoring.ts`
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/singleInstancePolicy.ts`
- `tests/integration/desktopDraftAdoption.test.ts`
- `apps/desktop/tests/main/draftWorkingCopyStore.test.ts`
- `apps/desktop/tests/main/projectChapterService.test.ts`
- `apps/desktop/tests/main/chapterHandlers.test.ts`
- `apps/desktop/tests/main/singleInstancePolicy.test.ts`
- This Task 8 implementation report.

## Release-Blocking Test Coverage

- Deferred and out-of-order saves, obsolete and expired tokens, exact-content
  binding, and cross-chapter token identity.
- Pre-write and post-write supersede failure, post-write target failure, and
  adoption plus compensation failure with final record/report assertions.
- Stale recovery, failed-discard gating, and discard/adoption/later-save races.
- Symlinked files/directories, deterministic component swap, unavailable
  descriptor anchoring, huge bounded reads, corrupt records, permissions, and
  failed atomic replacement.
- Safe service and IPC recovery classifications plus raw path/error redaction.
- Modal focus and manuscript preview behavior.
- Electron lock denial and second-instance restore/show/focus behavior.
- Byte-identical generated `draft_v1.md`, `story_state.json`, and
  `chapter_queue.json` invariants.

## Verification

Final round-2 verification on 2026-08-05:

- Affected Task 8 desktop matrix:
  `9` files, `239` tests passed.
- Root revision-schema/draft-adoption/chapter-draft matrix:
  `3` files, `13` tests passed.
- Complete desktop suite:
  `36` files, `565` tests passed.
- `corepack pnpm build`
- `corepack pnpm --dir apps/desktop check`
- `corepack pnpm --dir apps/desktop build`
- `corepack pnpm check:diff`
- `git diff --check`

One earlier complete-suite run produced the known participant-editor focus
timing failure (`564/565`). The failing file then passed in isolation (`7/7`),
and a fresh complete-suite rerun passed all `565/565` tests without production
changes to that unrelated feature.

Final round-3 verification on 2026-08-05:

- Root author-revision/draft/lease focused matrix: `7` files, `70` tests
  passed.
- Desktop store, contract, service, IPC, preload, renderer, state-protection,
  and single-instance coverage is included in the complete desktop run.
- Complete desktop suite with constrained workers: `36` files, `571` tests
  passed, `0` failed.
- `corepack pnpm build` passed.
- `corepack pnpm --dir apps/desktop check` passed.
- `corepack pnpm --dir apps/desktop build` passed.
- `corepack pnpm check:diff` and `git diff --check` passed after the report
  update.

Final round-4 verification on 2026-08-05:

- Root author-revision, invalidation, draft-adoption, atomic-write, and lease
  focused matrix: `8` files, `90` tests passed, `0` failed.
- Desktop recovery service/editor/workspace focused matrix: `3` files, `91`
  tests passed, `0` failed.
- Complete desktop suite with two workers: `36` files, `574` tests passed,
  `0` failed.
- `corepack pnpm build` passed.
- `corepack pnpm --dir apps/desktop check` passed.
- `corepack pnpm --dir apps/desktop build` passed.
- `corepack pnpm check:diff` and `git diff --check` passed after the report
  update.

Final round-5 verification on 2026-08-05:

- Root revision-schema, infrastructure, author-revision, invalidation, draft,
  adoption, lease, race, and fault matrix: `12` files, `102` tests passed,
  `0` failed.
- Desktop service, contract, IPC, preload, working-copy, editor, and workspace
  focused matrix: `7` files, `236` tests passed, `0` failed.
- Complete desktop suite with two workers: `36` files, `576` tests passed,
  `0` failed.
- `corepack pnpm build` passed.
- `corepack pnpm --dir apps/desktop check` passed.
- `corepack pnpm --dir apps/desktop build` passed.
- `corepack pnpm check:diff` and `git diff --check` passed after the report
  update.

Final round-6 verification on 2026-08-17:

- Root revision, invalidation, draft, adoption, adjustment, lease, race,
  safety, and fault matrix: `12` files, `128` tests passed, `0` failed.
- Desktop service, contract, IPC, preload, working-copy, editor, and workspace
  focused matrix: `7` files, `240` tests passed, `0` failed.
- Complete desktop suite with two workers: `36` files, `580` tests passed,
  `0` failed.
- `corepack pnpm build` passed.
- `corepack pnpm --dir apps/desktop check` passed.
- `corepack pnpm --dir apps/desktop build` passed.
- `corepack pnpm check:diff` and `git diff --check` passed after the report
  update.

## Safety Evidence

- Draft adoption runs under a no-Story-State-write project/chapter lease.
- The invalidation report records identical queue-before and queue-after
  snapshots and `storyStateMutated: false`.
- Generated `draft_v1.md` remains the immutable source artifact; adopted prose
  is stored under `author_revisions`.
- A recovery-required failure is a schema-validated serializable result. It
  does not delete provenance or the working copy and cannot reuse the uncertain
  adoption token.
- A process crash cannot leave a superseded-only revision set: a prepared
  journal restores a valid active revision before author content is returned.
- Recovery can mutate only schema-bound canonical author revision records, and
  only when every record is exactly a declared before/intended value.
- A persisted committed marker is never compensated; the renderer is locked
  until a fresh read resolves the durability-uncertain result.
- Project lock publication and stale takeover are owner-complete,
  process-start-bound, exclusive, heartbeat-recoverable, and
  directory/inode-identity-checked. Exact cleanup never overwrites a newer
  canonical claimant.
- Electron sandboxing remains enabled before the single-instance policy runs.
- `.playwright-mcp/` and the two unrelated readiness PNG files were neither
  modified nor staged.

## Remaining Limitations

- Working copies are local recovery data, not cross-device synchronization.
- Adoption-journal recovery is intentionally fail-closed. A damaged journal or
  failed recovery write blocks author-revision reads and requires operator
  repair; the engine will not guess which revision should be active.
- Secure working-copy persistence currently requires Linux procfs descriptor
  paths. Windows and macOS support must add an equivalent native descriptor-
  relative primitive before enabling persistence there.
- Adopting a draft invalidates future diagnostics but intentionally does not run
  diagnostics or create final/canon/commit artifacts in Task 8.
