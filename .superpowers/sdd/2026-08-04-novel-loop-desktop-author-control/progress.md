# SDD ledger — plan: docs/superpowers/plans/2026-08-04-novel-loop-desktop-author-control.md

Base plan commit: 01fcd3e11300a1d101471dbd690dacfc48b1a23c
Execution mode: subagent-driven-development

Task 1: fix round 1
- Reviewer finding: `formatPlanCandidateMarkdown` must strip/demote empty ATX H1 lines (`#` and `#   `) so every artifact contains exactly one level-one heading.
- Fix base: 6ebb1cf4a28fa8977662230923339b59d45c03c6

Task 1: complete
- Commits: 6ebb1cf4a28fa8977662230923339b59d45c03c6, 9e6d93d70b5bcc6a4399748e83435151260767d9
- Verification: 78 focused/compatibility tests passed; root build passed.
- Review: spec compliant after fix round 1; no remaining Critical/Important/Minor findings.

Task 2: fix round 1
- Important: adoption must re-hash `sourceArtifactPath` and reject stale source content before changing revision metadata.
- Minor (deferred to final review): revision ID schema uses exactly three chapter digits while generation supports chapter 1000+.
- Fix base: f388da6712c940cf875c1d608feb0320325efacc

Task 2: complete
- Commits: f388da6712c940cf875c1d608feb0320325efacc, 175ac2902de1b02811f2e5a5a228031855181c71
- Verification: 11 focused tests passed; root build passed.
- Review: stale-source Important resolved in fix round 1.
- Deferred Minor: chapter-1000 revision ID regex consistency.

Task 3: fix round 1
- High: archived downstream artifacts remain active and conflict with queue `planned_ready/ranking`.
- High: first alternative-plan adoption loses immutable model recommendation provenance.
- Important: repeated adoption can overwrite the revision's archived source.
- Important: revision-state transitions are not restored when a later adoption write fails.
- Fix base: 7e906f4

Task 3: fix round 2
- Original four findings resolved.
- New Important: rollback cleanup deletes the recovery archive even when a restore step fails; archive must survive failed rollback.
- Out-of-scope deferred: shared Task 2 archive helper can leave partial no-clobber files after late failure.
- Fix base: 1a45e36

Task 3: complete
- Commits: 7e906f4, 1a45e36, 716f783
- Verification: Task 3/lifecycle 20 tests passed; Task 2/storage 16 tests passed; root build passed.
- Review: all four original findings and rollback-cleanup breakage resolved.
- Deferred: shared Task 2 partial archive retry behavior remains for final review.

Task 4: fix round 1
- Important: mission adoption must archive/remove/rollback existing diagnostics downstream artifacts.
- Important: nonempty but duplicate/unknown participant rosters must fail before provider invocation.
- Fix base: 8661c87

Task 4: complete
- Commits: 8661c87, 3ac1dcc
- Verification: Task 4 25 tests passed; Task 2/3 shared regressions 25 tests passed; root build passed.
- Review: diagnostics invalidation and mixed-invalid roster findings resolved.

Task 5: fix round 1
- Important: candidate IDs and ancestor symlinks can escape `plan_candidates`; enforce identifier validation and real-path containment before reading.
- Important: public leakage guards miss generic POSIX/macOS/Windows/relative/encoded paths and IDs, and excerpt fields bypass validation.
- Important: revision tokens are consumed before adoption succeeds; failed/busy adoption must remain retryable.
- Important: mission edits cannot round-trip existing `charactersToIntroduce` without converting or dropping them.
- Minor: public opaque-token schemas accept 24 hex characters (96 bits) instead of exactly 48 hex characters (192 bits).
- Fix base: d173d90

Task 5: fix round 2
- Resolved in round 1: candidate containment, introduced-participant round-trip, and exact 192-bit token schemas.
- Important: leakage guard remains bypassable by deeper encoding/backtick/colon/standalone artifact names and rejects valid three-way slash prose.
- Important: capacity eviction can remove an in-flight reserved revision token, breaking retry after a non-mutating failure.
- Fix base: cf433ff

Task 5: fix round 3
- Resolved in round 2: bounded deep decoding/backtick/colon/raw artifact checks, valid slash prose, and reserved-token capacity behavior.
- Important: hand-maintained HTML entity aliases omit standard named entities such as `&lowbar;`, allowing encoded internal IDs/artifact names through.
- Fix base: 04f7468

Task 5: complete
- Commits: d173d90, cf433ff, 04f7468, c9ac669
- Verification: 161 focused tests passed; desktop TypeScript checks and root build passed.
- Review: spec compliant after three bounded fix rounds; no remaining Critical/Important/Minor findings.
- Security closure: candidate containment, renderer leakage guards, reservation atomicity/capacity, participant origin round-trip, and exact 192-bit tokens verified.

Task 6: fix round 1
- Important: in-flight mission/plan saves can mark newer unsaved edits as saved and expose an older revision token for adoption.
- Important: review refresh preserves editor state with old opaque bindings while installing a new review token; rejected refresh leaves stale content rendered.
- Important: editing bound debts clears their token and partially blank character changes are silently discarded.
- Important: unavailable/rejected participant preflight falls through to draft generation.
- Important: mission adoption warning omits plan candidates, ranking, and selected plan invalidation.
- Important: radio/tab composites lack required keyboard behavior; preview unmount loses native textarea undo history.
- Minor: raw `Untitled Plan` can still render in the editor/preview.
- Fix base: 1e6325e

Task 6: fix round 2
- Resolved in round 1: save races, refresh token generations, partial character validation, fail-closed preflight, keyboard semantics, textarea persistence, and untitled-title sanitization.
- Important: bound debt wording remains editable/displayed as adopted although the Task 5 contract sends only its token; must be canonical/read-only or otherwise not promise an unsent change.
- Important: mission comparison/adoption still uses direction-specific `原方向` / `按照新方向` copy.
- Minor: direct mission adoption cancellation does not restore focus to its original trigger.
- Minor: `AI 推荐` is visually shown but omitted from the radio accessible description/name.
- Fix base: 30c8f895

Task 6: fix round 3
- Resolved in round 2: canonical read-only bound debts, artifact-specific comparison/warnings, direct-adopt focus restoration, accessible AI recommendation, and project-unavailable mapping.
- Important: character-delta comparison omits the selected participant name even though its participant token is editable and transmitted.
- Parent/editor focus race observed under full renderer concurrency: mission editor focus can be stolen back by the chapter review heading.
- Fix base: a5470c7

Task 6: complete
- Commits: 1e6325e, 30c8f895, a5470c7, 0d3c07d
- Verification: required suite 40/40; full renderer suite 144/144 passed twice; desktop TypeScript checks passed.
- Review: spec compliant after three bounded fix rounds; no remaining Critical/Important/Minor findings.
- UX closure: save/refresh races, exact structured comparison, fail-closed participant recovery, complete invalidation copy, keyboard/focus behavior, and Chinese title sanitization verified.

Task 7: fix round 1
- Important: mission adjustment normalization drops objective metadata, reader suspicions/answers, emotional curve, target word count, and can default/overwrite trusted identity fields.
- Important: source freshness check and revision-store reread allow a TOCTOU that can bind old AI output to a newer source hash.
- Important: cancellation during final freshness/read/storage window can still persist a revision and publish success.
- Important: reused adjustment panel and main same-kind task coalescing can mix option/source/instruction/results across requests; initial participant-repair focus race persists.
- Important: renderer projection/label validation can fail after the ready revision is already persisted.
- Minor: incomplete task kind/stage matrix, stale error mapping, and insufficient prompt-context minimization checks.
- Fix base: 5cac6b9

Task 7: fix round 2
- Resolved in round 1: strict complete mission schema, exact source hash, final cancellation gate, request fingerprint isolation, stale mapping, and basic pre-persistence projection.
- Important: participant repair scope is enforced only by renderer instruction; backend must preserve all non-participant fields and validate objective identity/uniqueness.
- Important: engine author-facing text guard is weaker than desktop IPC guard, allowing revision persistence before desktop rejection.
- Important: post-commit working-copy rereads/token publication/schema parsing can fail after ready revision persistence, leaving unreachable orphan revisions.
- Important: adjustment still permits draft-generation navigation and same-mount participant-repair focus remains timing-sensitive.
- Minor: planning/drafting stage sets remain cross-compatible; Story State summary truncation can emit invalid partial JSON.
- Fix base: 9e3d0be

Task 7: fix round 3
- Resolved in round 2: trusted participant merge, shared author-facing guard, post-commit reread removal, renderer isolation/focus, exact stages, and valid bounded summary.
- Important: every introduction name/role must be independently validated before persistence even when its ID is absent from `participatingCharacterIds`.
- Important: publication reservation evicts an existing token before the new publication succeeds and does not restore it on failure.
- Important: ready revision persistence precedes in-memory token publication; cleanup cannot close crash/storage-failure orphan windows without a durable non-ready publication state and recovery/promotion.
- Minor: Story State context should prioritize mission/plan-referenced characters before first-N fill.
- Fix base: 63a7651

Task 7: local closure
- Important: introduced narrative-debt `type` bypassed author-facing leakage validation.
- Important: recovery reset durable token age and could resurrect expired or capacity-evicted publications.
- Important: recovery could discard a live unbound publication in both adjustment-before-read and recovery-before-adjustment interleavings.
- Minor: trusted plan context recognized internal character IDs but not author-facing names.
- Closure base: 4ba5fe5

Task 7: complete
- Commits: 5cac6b9, 9e3d0be, 63a7651, 4ba5fe5, 388f01f
- Verification: root/schema suite 54/54; required desktop suite 234/234; root build and desktop node/web/e2e TypeScript checks passed.
- Review: final independent review passed with no remaining Critical/Important/Minor findings.
- Safety closure: durable publication TTL/capacity, forward/inverse recovery serialization, complete mission leakage traversal, and author-facing plan context prioritization verified without Story State or queue mutation.

Task 8: fix round 1
- Critical: obsolete adoption tokens can adopt older text and delete the newest working copy.
- Critical: overlapping autosaves can complete out of order and overwrite newer edits.
- Critical: second draft adoption is not failure-atomic and can remove the previous active author revision.
- Important: future diagnostics invalidation, stale recovery gating, user-data containment/bounded reads, error redaction, dialog focus, and release-blocking tests are incomplete.
- Minor: `versionKind` is optional and preview is raw Markdown text.
- Fix base: 4763142
- Original implementer interrupted by model-capacity error after partial uncommitted fixes; replacement implementer must continue from the shared working tree without discarding them.

Task 8: fix round 2
- Critical: a supersede record that persists and then throws is not registered for rollback, so the previous active author revision can still be lost.
- Important: compensation failure can leave an active target without its invalidation provenance or a distinct safe recovery classification.
- Important: autosave ordering is process-local because Electron does not yet enforce a single application instance.
- Important: draft adoption tokens compare project/source but not chapter number.
- Important: path-component checks do not close symlink component-swap races during write operations.
- Fix base: 1486154

Task 8: fix round 3
- Critical: author-revision adoption still lacks durable recovery across process/machine termination between multi-record writes.
- Important: recovery-required classification is attached to Error and is lost by Electron IPC serialization.
- Important: serialized JSON record size can exceed the read cap for otherwise valid escape-heavy Markdown.
- Important: permissive UTF-8 decoding can surface corrupt bytes as replacement-character prose.
- Minor: a child directory descriptor can leak if chmod/stat throws before handle registration.
- Fix base: 07cad64

Task 8: fix round 4 (fresh implementer required)
- Critical: a forged schema-valid journal can target canonical non-revision JSON such as `planning/chapter_queue.json` during recovery.
- Critical: concurrent stale-lock reclaimers can remove a newly acquired live project lease.
- Important: committed-marker persist-then-throw can be compensated into records inconsistent with a durable committed marker.
- Important: lease acquisition has an ownerless crash window and PID-only identity is unsafe under PID reuse.
- Important: renderer recovery reload does not reset editor state, and Ctrl+S bypasses the recovery gate.
- Minor: terminal adoption journals are unbounded and damaged historical terminal journals block reads.
- Fix base: 4806191

Task 8: fix round 5 (fresh implementer required)
- Important: a third edit can lose its autosave when an older queued save resets saveState to saving and cancels the newest timer.
- Important: transition claims have no stale-owner recovery and can permanently block the project after crash/rename failure.
- Important: directory rename is replace-capable on Linux; publication is not atomic no-replace and post-publication verification failure can orphan a live lock.
- Important: terminal journals are archived without validating records match committed/intended or recovered/before terminal state.
- Important: untrusted journal archive version filenames use unsafe Number conversion and can collide/block adoption.
- Important: lease owner/claim metadata reads are unbounded, symlink-following, and FIFO-capable.
- Minor: Linux lease identity lacks boot ID; recovery-required UI does not focus the recovery action.
- Fix base: b5ea893

Task 8: fix round 6 (fresh implementer)
- Important: a live orphan transition claim can permanently block release because acquisition ignores it and live claims cannot be reclaimed.
- Important: removeExactPath has a check/rename ABA race and restoration can overwrite a newer claimant.
- Important: working-copy FIFO reads omit O_NONBLOCK and can hang Electron main indefinitely.
- Important: preview mode unmounts the textarea and destroys native undo/redo history.
- Minor: recovery/discard focus runs before React renders or re-enables the destination control.
- Fix base: fd1e379

Task 8: fix round 7 (fresh implementer)
- Critical: an exact live transition claimant is expired by TTL without fencing; it can resume and destructively transition a successor lock, breaking mutual exclusion.
- Important: after the canonical owner is successfully moved and verified, claim cleanup failure rethrows before terminal resource cleanup and can report a completed business callback as failed.
- Minor: round-6 root focused count reports 128 but the reproducible matrix contains 124 tests.
- Fix base: 136e549

Task 8: fix round 8
- Important: withProjectChapterOperationLease performs one pre-commit release attempt and discards the private retryable lease handle; a transient canonical rename failure can lock the project until process exit.
- Fix base: 01d3a8d

Task 8: fix round 9
- Important: failed-release retention exists only in withProjectChapterOperationLease; direct acquireProjectBuildLock callers in buildBible and planGlobal can still lose a retryable live lease and lock the process.
- Fix base: ea5b391

Task 8: complete
- Final commit: 88a6e17
- Independent review: PASS with no Critical, Important, or Minor findings.
- Verification: round-9 build/planning/lease 59/59; Task 8 root 134/134; desktop focused 240/240; desktop full 580/580; root build, desktop check/build, and diff checks passed.
- Safety closure: all production lease callers share managed retained-release recovery; draft adoption, autosave, working-copy storage, crash recovery, IPC redaction, Story State, queue, and generated draft invariants are covered.

Task 8: fix round 9 complete
- ProjectBuildLock now uses the same resolved-root managed release registry as
  chapter operations; no duplicate recovery registry or lease owner exists.
- Real buildBible fault injection covers transient retry, exhausted-handle
  recovery by a later chapter operation, persistent explicit failure, callback
  exclusion, protected-byte identity, and terminal resource cleanup.
- Verification: lease/build/planning 59/59; root Task 8 134/134; desktop focused
  240/240; complete desktop 580/580; root build, desktop check/build, and diff
  checks passed.

Task 8: fix round 6 complete
- Transition claims are preflighted before acquisition, heartbeat while active,
  recover after bounded loss of progress, and can be resumed by the exact lease
  after combined release/cleanup failure.
- Exact metadata cleanup uses inode pinning plus no-overwrite quarantine
  restoration; deterministic ABA replacement preserves the newest claimant.
- FIFO working-copy records fail fast with `O_NONBLOCK`; preview retains one
  textarea DOM node; recovery/discard focus is fulfilled post-render.
- Verification: root focused 124/124; desktop focused 240/240; complete desktop
  580/580; root build and desktop check/build passed; diff checks passed.

Task 8: fix round 7 complete
- Exact live transition claims are never reclaimed by elapsed time alone;
  deterministic three-participant coverage proves mutual exclusion remains
  intact after pause, claim aging, competing takeover, and resume.
- Canonical-owner move plus exact identity verification is the release commit
  point. Later claim cleanup failure cannot reject the completed callback;
  owner/claim heartbeats and released-path cleanup terminate safely.
- Verification: lease focused 29/29; root focused 125/125; desktop focused
  240/240; complete desktop 580/580; root build and desktop check/build passed;
  diff checks passed.

Task 8: fix round 4 complete
- Canonical journal identity prevents recovery writes to Story State, queue,
  generated drafts, or unrelated files; ambiguous records fail closed.
- Project leases publish complete process-start-bound owners and use exclusive,
  directory-identity-checked stale takeover.
- Committed-marker durability uncertainty never compensates intended records;
  terminal journals are verified, archived, and retained to a bound of eight.
- Recovery reload remounts the editor, and recovery-required mode blocks all
  mutation/adoption controls and keyboard shortcuts.
- Verification: focused root 90/90; focused desktop 91/91; complete desktop
  574/574; root build, desktop check/build, and diff checks passed.

Task 9: complete
- Implementation commits: `a727e72`, `e30034b`, `0d61752`, and `a5dbc07`.
- The fake-Codex Electron acceptance covers author direction selection,
  mission/plan editing and adoption, participant repair, draft generation,
  autosave, restart recovery, and explicit author-revision adoption.
- Story State, `latestCommittedChapter`, generated draft bytes, and the
  post-drafting queue remain protected; renderer IPC exposes only bounded
  author-facing values.
- All Electron E2E launches require `chromiumSandbox: true`; actual child
  arguments reject unsafe sandbox switches. The former Playwright main-process
  evaluation flake reproduced at 3/5 before the fix and passed 20/20 after it.
- Verification: root 199 files / 655 tests; desktop 36 files / 584 tests;
  Electron E2E 9/9; root and desktop checks/builds plus diff checks passed.
- Fresh independent review: PASS with no Critical, Important, or Minor
  findings; reviewer security smoke 5/5, focused author flow 1/1, and full
  Electron E2E 9/9.
