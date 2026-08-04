# Task 8 Implementation Report

## Scope

Completed Task 8 and reviewer fix rounds 1-2 for recoverable Chapter Draft
editing on `codex/novel-loop-desktop-prototype`.

- Base implementation: `4763142de0844979bfcde85271271bd6a2ce0b46`
- Fix round 1: `1486154474ee30ebb6bdf00847ea4a1f7050358e`

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

### Failure-Atomic Adoption And Provenance

- Every revision that may be changed is added to the rollback set before its
  write starts. This covers writes that persist and then throw for both the
  superseded revision and the new adoption target.
- In-process write failures restore the target plus every prior active
  revision in reverse write order.
- If a compensation write also fails, the operation returns
  `AUTHOR_REVISION_ROLLBACK_FAILED`; the desktop service maps this to the safe
  `DRAFT_ADOPTION_RECOVERY_REQUIRED` classification and IPC maps it to
  `CHAPTER_DRAFT_RECOVERY_REQUIRED` without preserving raw filesystem text.
- The schema-validated `edit_invalidation_report_vN.json` is deliberately kept
  when compensation fails. Any durable adopted target therefore retains a
  resolvable `invalidationReportPath` for operator recovery.

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
- Reads are bounded, descriptor-based, and no-follow. Malformed, oversized,
  and symlinked records are rejected or quarantined.
- The current secure primitive is supported for the Ubuntu 24.04 first release.
  Non-Linux platforms, missing procfs, or unavailable no-follow/directory flags
  fail closed with `DRAFT_WORKING_COPY_UNAVAILABLE`; there is no pathname-only
  fallback.

### Renderer And IPC Boundary

- Recovered and stale copies remain gated until explicit continue or durable
  discard. Failed discard leaves the recovery choice active.
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

## Safety Evidence

- Draft adoption runs under a no-Story-State-write project/chapter lease.
- The invalidation report records identical queue-before and queue-after
  snapshots and `storyStateMutated: false`.
- Generated `draft_v1.md` remains the immutable source artifact; adopted prose
  is stored under `author_revisions`.
- A recovery-required failure does not delete provenance, does not delete the
  working copy, and cannot reuse the uncertain adoption token.
- Electron sandboxing remains enabled before the single-instance policy runs.
- `.playwright-mcp/` and the two unrelated readiness PNG files were neither
  modified nor staged.

## Remaining Limitations

- Working copies are local recovery data, not cross-device synchronization.
- The multi-record adoption transaction compensates all observable in-process
  failures. A hard process or machine crash between record writes still needs a
  future durable adoption journal; no success is reported after a detected
  compensation failure.
- Secure working-copy persistence currently requires Linux procfs descriptor
  paths. Windows and macOS support must add an equivalent native descriptor-
  relative primitive before enabling persistence there.
- Adopting a draft invalidates future diagnostics but intentionally does not run
  diagnostics or create final/canon/commit artifacts in Task 8.
