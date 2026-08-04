# Task 8 Implementation Report

## Scope

Completed Task 8 fix round 1 for recoverable Chapter Draft editing on
`codex/novel-loop-desktop-prototype`, preserving the interrupted working tree
from base implementation commit `4763142de0844979bfcde85271271bd6a2ce0b46`.

The implementation remains inside the approved desktop boundary: no Story
State or chapter-queue mutation, no diagnostics/final/canon-patch/commit work,
and no provider or renderer filesystem expansion.

## Reviewer Finding Closure

- Draft adoption tokens are content-bound, project/chapter-bound, expiring,
  bounded, and revoked whenever a newer working copy is read or saved. Retired
  tokens cannot immediately be reissued.
- Draft read/save/discard/adopt operations are serialized per project. The
  renderer also serializes autosaves by edit version, so an older completion
  cannot overwrite a newer edit or mark it saved.
- Author-revision adoption snapshots the target and every superseded active
  revision. Any write failure restores the target and the previous active
  revision before returning an error.
- Draft adoption emits a schema-validated `edit_invalidation_report_vN.json`
  with `future_diagnostics` invalidated and binds its relative path to the
  adopted author revision.
- Recovered and stale working copies remain gated until the author explicitly
  continues or a durable discard succeeds. A failed discard leaves the gate
  and recovery state intact.
- Working-copy storage rejects symlinked path components and files, performs
  bounded no-follow reads, quarantines malformed/oversized records, and uses
  exclusive temporary files plus atomic rename.
- Main-service and IPC boundaries map storage failures to fixed public errors;
  absolute user-data paths and raw filesystem messages do not cross IPC.
- Confirmation dialogs provide initial focus, focus trapping, Escape/cancel,
  focus restoration to the exact opener, modal semantics, and accessible
  labels.
- `versionKind` is required by the public draft-review schema. Preview renders
  safe manuscript headings and paragraphs instead of a raw Markdown text node.

## Changed Files

- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx`
- `apps/desktop/src/renderer/src/styles/chapter.css`
- `apps/desktop/src/shared/chapterContract.ts`
- `src/app/chapterAuthorRevision.ts`
- `src/desktop/chapterAuthoring.ts`
- Task 8 desktop contract, store, service, IPC, renderer, and root integration
  tests associated with those modules.

## TDD Evidence

The first focused RED run exposed ten failures covering the optional
`versionKind`, IPC filesystem-message leakage, symlinked working-copy
directories, obsolete adoption tokens, exact-content adoption, error
redaction, manuscript preview, and the missing invalidation report. The root
integration test also failed because the required report did not exist.

Two later release-blocking cases were independently made RED before their
fixes:

- A deferred autosave recreated a working copy after discard.
- A simulated target-record write that persisted and then threw left the new
  author revision active instead of restoring it.

The production changes then made those tests and the complete affected suites
green.

## Release-Blocking Test Coverage

- Deferred and out-of-order saves: serialized store writes and renderer save
  completion/version tests.
- Obsolete tokens: old-token revocation, expiry, and exact current-copy binding.
- Second-adoption failure: target-write and supersede-write rollback tests.
- Stale recovery: explicit continue/discard gating and failed-discard retention.
- Discard/adoption races: serialized service operations and conditional cleanup
  that cannot delete a later save.
- Storage hardening: symlinked file/directory rejection, oversized bounded
  reads, malformed-record quarantine, restrictive modes, and failed atomic
  replacement preservation.
- Error redaction: service and all four IPC draft operations reject raw paths
  and filesystem messages.
- Modal behavior: initial focus, Escape, focus restore, focus trap, and modal
  accessibility.
- State protection: generated `draft_v1.md`, `story_state.json`, and
  `chapter_queue.json` remain byte-identical after adoption.

## Verification

Passed on 2026-08-05:

- Focused Task 8 desktop tests:
  `5` files, `210` tests passed.
- Affected service/IPC/preload/schema/state-protection/renderer tests:
  `8` files, `230` tests passed.
- Root revision-schema/draft-adoption/chapter-draft tests:
  `3` files, `11` tests passed.
- Isolated participant-focus regression check:
  `1` file, `7` tests passed.
- Complete desktop suite:
  `35` files, `558` tests passed.
- `corepack pnpm build`
- `corepack pnpm --dir apps/desktop check`
- `corepack pnpm --dir apps/desktop build`
- `corepack pnpm check:diff`
- `git diff --check`

## Safety Evidence

- Draft adoption runs under a no-Story-State-write project/chapter lease.
- The invalidation report records identical queue-before and queue-after
  snapshots and `storyStateMutated: false`.
- The renderer receives only author-facing content/state and opaque adoption
  tokens. It receives no filesystem paths, hashes, run IDs, internal revision
  IDs, schema names, or raw filesystem errors.
- Generated `draft_v1.md` is retained as the immutable source artifact; adopted
  prose is stored under `author_revisions`.
- `.playwright-mcp/` and the two unrelated readiness PNG files were neither
  modified nor staged.

## Remaining Limitations

- Working copies are local recovery data, not a cross-device synchronization
  mechanism.
- If the filesystem fails both the adoption write and the compensating rollback
  writes, the operation fails with `AUTHOR_REVISION_ROLLBACK_FAILED` and
  requires operator inspection; it never reports a successful adoption.
- Adopting a draft invalidates future diagnostics but intentionally does not run
  diagnostics or create final/canon/commit artifacts in Task 8.
