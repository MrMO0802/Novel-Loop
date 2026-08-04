# Task 8 Implementation Report

## Scope

Completed Task 8 and reviewer fix rounds 1-3 for recoverable Chapter Draft
editing on `codex/novel-loop-desktop-prototype`.

- Base implementation: `4763142de0844979bfcde85271271bd6a2ce0b46`
- Fix round 1: `1486154474ee30ebb6bdf00847ea4a1f7050358e`
- Fix round 2: `07cad6426fcb97c3a9867ad4f30f25f741061988`

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
