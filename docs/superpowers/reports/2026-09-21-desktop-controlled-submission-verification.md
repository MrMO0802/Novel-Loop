# Desktop Controlled Submission Verification

Date: 2026-09-21. Approved design and implementation plan completed on the
existing desktop branch. No Git staging/commit or real novel submission.

## Author Workflow

Save or autosave the working copy, explicitly adopt the intended revision,
then select `检查并提交` and `开始检查`. Review all story changes, check the
approval checkbox, select `正式提交第 N 章`, and confirm in the dialog.
Only this final local confirmation changes formal Story State. Success offers
the existing next-chapter planning flow; an exhausted outline returns to planning.

Manual save remains available after autosave. Unadopted edits, stale previews,
failed diagnostics, unsafe evidence, or incomplete journals block submission.
Confirmation uses the exact reviewed prose and makes no provider call.

## Verification Evidence

| Gate | Result |
| --- | --- |
| Root build and typecheck | PASS |
| Root full suite, `corepack pnpm test --maxWorkers=2` | 205 files, 902 tests PASS |
| Desktop full suite, `corepack pnpm --dir apps/desktop test --maxWorkers=2` | 44 files, 917 tests PASS |
| Final publication/linkage fix | 33 new publication tests + 187 affected preview/commit/audit tests PASS |
| Independent final scoped re-review | PASS; independently reran 33 publication tests |
| Post-fix `corepack pnpm desktop:build` | PASS |
| Post-fix `corepack pnpm --dir apps/desktop check` | PASS |
| Post-fix `corepack pnpm --dir apps/desktop test:e2e:required` | 14 PASS, no skips, one worker, 2.5 minutes |

The full root and desktop suites ran before the last four-file engine linkage
fix. That fix received the affected 220-test regression and independent review;
the application was rebuilt and all required Electron tests rerun afterwards.
The full root suite was not rerun a second time. Builds and checks completed
successfully; verification is not inferred from source presence.

Persistence tests inject exceptions before/after 55 logical FileStore operations
(110 scenarios), including state-written/journal-update failure. This is not a
claim of OS power-loss testing or a multi-file atomic transaction.

Electron tests use separate temporary project/registry data and fake Codex.
They cover exact adopted-B submission with original-A retention, restart,
next-chapter navigation, diagnostics hard failure, quota failure, autosaved but
unadopted edits, stale previews, cancellation, and renderer privilege boundaries.
Screenshots at 1440x900 and 1024x768 were inspected; approval controls remain
visible, modal focus is safe, and no text overlap was observed.

## Review Closure

Every implementation slice received independent review. Final integrated review
found a preview-publication interruption gap: manifest existence alone allowed
confirmation without a durable ready task. The fix requires matching manifest,
ready task and successful check run in admission, confirmation and recovery;
audit uses the same linkage checks. Incomplete evidence remains blocked and
audit-visible, never silently repaired. Post-ready-write exceptions preserve
coherent durable evidence and pass strict audit after confirmation.

Detailed review evidence and all execution rulings are retained in
`.superpowers/sdd/2026-09-21-desktop-controlled-submission/progress.md` and its
task reports. The scratch evidence was retained because no Git commit was made.

## Limits And Incident Record

- No real Codex generation or real-project commit was performed. Generation
  quality, packaging and distribution are separate acceptance work.
- The first Electron attempt accidentally resolved real Codex health probes
  through PATH. It was stopped; no real generation was observed. The test now
  provides a private fake-only PATH, and the final runs used that isolation.
- Existing provider retry policy is unchanged: quota denial may receive one
  bounded internal retry. The UI never starts another task automatically.
- Incomplete publication/journal evidence requires explicit inspection;
  there is no automatic repair, rollback, historical recommit or conflict repair.
- No new provider, workspace-write privilege, cloud account or renderer
  filesystem/shell capability was added. No free usage reset was consumed.

## Repository Sync Verification

Later on 2026-09-21, the user requested a current README and SSH repository
sync. The checks below were rerun before committing the desktop work:

- Root build, root typecheck and desktop typecheck: PASS.
- Full root suite: 206 files / 935 tests, with 934 passing and one README
  quickstart assertion failing because the explicit Corepack init example was
  missing. No business-code test failed.
- The README example was corrected without changing implementation or tests.
  The documentation, package-assets and release-checklist suites were rerun:
  3 files / 11 tests PASS. The full root suite was not rerun after this
  documentation-only correction.
- Full desktop suite: 44 files / 917 tests PASS.
- The 14-test Electron result above belongs to the earlier post-fix run; no
  additional Electron or real Codex generation was run for repository sync.
- README relative links and staged whitespace checks passed. Runtime projects,
  screenshots, build output and authentication files were excluded from staging.
- Reachable history and nonignored working files were scanned for common secret
  formats. The only match was an intentional fake token in a redaction test.
  This is a pattern scan, not a guarantee that every possible secret is detected.

The earlier no-commit statement describes the implementation verification stage,
not the subsequent user-authorized repository sync. Local scratch review reports
remain local; this document is the checked-in verification summary.

## Start Locally

Restart the existing desktop development process so main and preload reload:

```bash
corepack pnpm desktop:dev
```

Run this from the repository root. It opens the native Electron window, not a
browser workflow. Secure Chromium sandboxing remains enabled.
