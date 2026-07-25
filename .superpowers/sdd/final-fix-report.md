# Gate 4 Final Fix Report

## Status

Complete. Independent final re-review passed with no Critical or Important findings.
Gate 4 received human approval on 2026-07-25.

The changes remain inside the fixture-driven browser prototype. They do not add Electron,
engine, Codex, filesystem, browser storage, provider, queue, snapshot, or Story State
integration.

## Findings Closed

### Commit safety and fixture consistency

- Chapter 2's accepted candidate is now the single source for the pending Story Record and
  Commit Preview fixture data.
- The pending and formal previews describe the same post-midnight sequence and no longer
  reintroduce the removed duplicate handoff.
- Commit readiness is bound to the accepted draft revision and content hash.
- Editing an accepted draft marks the preview stale and disables confirmation.
- Commit Preview remains blocked until a revision candidate has been accepted.

### State clarity

- Chapter 2's version selector no longer offers a committed version.
- Committed-history examples remain available through clearly separate fixture content.
- Story Record pending changes use the same candidate-derived payload as Commit Preview.

### Recovery, navigation, and focus

- Recovery inspection actions reveal a fixture-backed recovery summary instead of silently
  closing.
- Crash recovery exposes an identifiable, dated safe restore point.
- Unsupported chapters are visibly unavailable and no longer navigate to wildcard routes.
- Story Record links open the intended timeline and open-mystery views.
- Focus Mode is scoped to Chapter Workspace and is cleared when leaving that route.

### Validation and accessibility

- Passing Playwright runs retain screenshots under ignored `test-results/` output.
- Visual checks cover page-wide interactive-control collisions and clipped or wrapped labels
  in addition to route-specific geometry.
- Autosave changes use a polite live status.
- Non-blocking notices use status semantics; assertive alert semantics remain reserved for
  blocking errors.
- The moderated usability script retains the recovery-inspection task.

### Independent review follow-up

- The default project now consistently presents Chapter 2's revision candidate as awaiting
  the author's decision. Project Overview leads to comparison, recent activity no longer
  claims the candidate was accepted, and pending Story Record copy identifies the proposal
  as unaccepted.
- The moderated tasks continue from an explicit candidate acceptance into Commit Preview;
  a direct preview without acceptance remains safely blocked.
- Editing an accepted draft invalidates the old preview, and the author can explicitly
  regenerate the preview binding from the current accepted draft before resuming review.
- Inspect-labelled usage-limit, diagnostics, stale-candidate, and cancellation actions now
  reveal fixture-backed preserved-content summaries without closing the recovery dialog.
- Once the author accepts the candidate, Project Overview and the pending Story Record derive
  their labels, summaries, recent activity, and next action from the same session revision
  state. Returning to either route no longer regresses to undecided copy.
- The accepted-state overview leads directly to Commit Preview, while the default fixture
  continues to lead to revision comparison.

## Files Changed

- `.gitignore`
- `docs/product/novel-loop-prototype-test-script.md`
- `prototype/desktop/playwright.config.ts`
- `prototype/desktop/src/app/PrototypeContext.tsx`
- `prototype/desktop/src/components/InlineNotice.tsx`
- `prototype/desktop/src/features/editor/ManuscriptEditor.tsx`
- `prototype/desktop/src/features/recovery/RecoveryDialog.tsx`
- `prototype/desktop/src/fixtures/commitPreview.ts`
- `prototype/desktop/src/fixtures/rainRadio.ts`
- `prototype/desktop/src/fixtures/tasks.ts`
- `prototype/desktop/src/i18n/messages.zh-CN.ts`
- `prototype/desktop/src/pages/CommitPreviewPage.tsx`
- `prototype/desktop/src/pages/ProjectOverviewPage.tsx`
- `prototype/desktop/src/pages/StoryRecordPage.tsx`
- `prototype/desktop/src/shell/ApplicationShell.tsx`
- `prototype/desktop/src/shell/ChapterNavigator.tsx`
- `prototype/desktop/src/shell/CommandPalette.tsx`
- `prototype/desktop/src/styles/pages.css`
- `prototype/desktop/tests/chapter-workspace.test.tsx`
- `prototype/desktop/tests/commit-preview.test.tsx`
- `prototype/desktop/tests/navigation.test.tsx`
- `prototype/desktop/tests/onboarding.test.tsx`
- `prototype/desktop/tests/prototype-boundary.test.ts`
- `prototype/desktop/tests/recovery.test.tsx`
- `prototype/desktop/tests/status-model.test.tsx`
- `prototype/desktop/tests/story-record.test.tsx`
- `prototype/desktop/tests/visual/prototype.spec.ts`
- `prototype/desktop/vite.config.ts`

## Verification

| Command | Result |
| --- | --- |
| `corepack pnpm --dir prototype/desktop test` | Passed after cross-route state follow-up: 10 files, 207/207 tests, exit code 0, 127.05s. |
| `corepack pnpm --dir prototype/desktop test:visual` | Passed after cross-route state follow-up: 36 tests, 2 intentional viewport-specific skips, exit code 0, 2.8m. |
| `corepack pnpm --dir prototype/desktop check` | Passed: `tsc -b --pretty false`, exit code 0. |
| `corepack pnpm --dir prototype/desktop build` | Passed after cross-route state follow-up: 4,680 modules transformed, production bundle built in 1m 22s. Vite retains a non-blocking 500 kB prototype bundle warning. |
| `git diff --check` | Passed. |

An unrelated host process created sustained CPU and memory pressure during verification.
Vitest's explicit per-test budget is now 10 seconds so interaction tests retain their
behavioral assertions without failing on host scheduling jitter. The final suite completed
without retries or failures, and no verification process remains running.

## Independent Final Re-review

- Review range: `2a70117..93842c5`
- Critical findings: 0
- Important findings: 0
- Fixture-only boundary: confirmed
- Recommendation: Gate 4 PASS

The reviewer confirmed that accepted session state remains accepted across Project Overview
and pending Story Record, while the default fixture continues to present an undecided
candidate. The reviewer did not rerun tests and relied on the fresh verification evidence
recorded above.

## Residual Human-assisted Checks

- Chinese IME composition in the manuscript editor.
- Screen-reader reading order and announcements.
- Native tooltip behavior on supported operating systems.
- Browser or OS scaling at 200 percent.

These checks are documented in the moderated usability script and do not change the
fixture-only prototype boundary.
