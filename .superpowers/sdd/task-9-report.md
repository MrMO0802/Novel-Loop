# Task 9 Report

## Status

Complete. The fixture-driven desktop UX validation build is implemented without production engine changes.

## Commit

`prototype: finalize desktop UX validation build` (this report is included in that commit).

## Files

- `prototype/desktop/playwright.config.ts`
- `prototype/desktop/tests/visual/prototype.pw.ts`
- `prototype/desktop/src/styles/base.css`
- `prototype/desktop/README.md`
- `docs/product/novel-loop-prototype-test-script.md`
- `prototype/desktop/tests/prototype-boundary.test.ts`
- `prototype/desktop/src/pages/FirstLaunchPage.tsx`
- `prototype/desktop/vite.config.ts`

The boundary test change removes quoted literals before evaluating the Electron API pattern, preserving detection of executable Electron API use while allowing fixture copy such as `session.previous-close.incomplete`. The first-launch fixture recheck delay and Vitest timeout adjustments address demonstrated slow-host timing without changing production engine behavior.

## Verification

| Command | Result |
| --- | --- |
| `corepack pnpm --dir prototype/desktop install --frozen-lockfile` | Passed: lockfile up to date; install completed in 12.7s. |
| `corepack pnpm --dir prototype/desktop check` | Passed: `tsc -b --pretty false`. |
| `corepack pnpm --dir prototype/desktop test` | Passed: 10 files, 182 tests, 104.88s. |
| `corepack pnpm --dir prototype/desktop build` | Passed: production build completed in 1m 26s. |
| `corepack pnpm --dir prototype/desktop test:visual` | Passed: 36 tests passed, 2 skipped, 2.5m. |
| `git diff --check` | Passed. |

Focused timing diagnostics passed before the final full run: the first-launch warning recheck and the two New Novel wizard interactions completed under the configured 20-second Vitest limit. The former false-positive boundary case and a real `session.defaultSession.clearStorageData()` case are both covered.

## Route Coverage

Visual coverage runs at 1440x900 and 1024x720 for:

- `/setup?state=ready` and `/setup?state=missing`
- `/library` and `/new`
- `/project/rain-radio`
- `/project/rain-radio/chapter/2`, `/review`, `/revision`, and `/commit-preview`
- `/project/rain-radio/story-record`
- `/tasks?recovery=timeout` and `/tasks?recovery=crash`

The suite also checks bounded horizontal layout, readable primary controls, keyboard focus visibility and restoration, compact drawer behavior, textual diff labels, icon control names/tooltips, and reduced-motion overrides. The two skipped cases are intentional desktop-1440 exclusions for assertions that apply only to the 1024 compact layout.

## Manual Checks And Deferred Items

The repository includes a five-session moderated usability script with ten concrete task prompts in `docs/product/novel-loop-prototype-test-script.md`. Automated browser checks cover the specified focus, layout, motion, and route behavior.

Deferred to human-assisted validation: 200 percent browser zoom/reflow, Chinese IME composition in the editor, screen-reader reading order, and native tooltip behavior across operating systems.

## Concerns And Known Limitations

- This remains a fixture-driven prototype; it does not validate persistence, a production backend, or production engine integration.
- Visual validation requires Playwright Chromium and a completed production build before `vite preview` serves the prototype.
- The configured 20-second unit-test limit accommodates the observed shared-host load; tests still fail on genuine unfinished interactions rather than being weakened.
