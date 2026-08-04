# Task 5 Implementation Report

## Status

Complete. Electron now exposes only the fixed opaque chapter-authoring API.
Renderer requests and responses are strict and bounded; all trusted artifact
identifiers stay in main, where project-bound tokens are resolved before the
existing engine facade is called.

## Commit

- `feat(desktop): expose safe chapter authoring API` (this scoped commit)

## Files

- Renderer contract: `apps/desktop/src/shared/chapterContract.ts`,
  `apps/desktop/src/shared/desktopApi.ts`, and
  `apps/desktop/src/shared/ipcChannels.ts`.
- Trusted main boundary: `apps/desktop/src/main/chapter/ChapterReviewTokenStore.ts`,
  `apps/desktop/src/main/chapter/EngineChapterGateway.ts`,
  `apps/desktop/src/main/chapter/ProjectChapterService.ts`,
  `apps/desktop/src/main/ipc/registerChapterHandlers.ts`, and
  `apps/desktop/src/main/index.ts`.
- Named preload wrappers: `apps/desktop/src/preload/index.ts`.
- Security and state tests: the four Task 5 main test files plus the existing
  preload boundary test and renderer API fixture required by the strict API
  type check.

No renderer UI, Codex adjustment, draft autosave, generic invoke/file API,
`.playwright-mcp/`, or screenshot artifact was added to the commit.

## RED

- The initial contract/handler run failed 23 assertions because the opaque
  token schemas, strict authoring requests, fixed IPC channels, service methods,
  and preload methods did not exist.
- The token-store test initially failed at module resolution. Subsequent RED
  checks exposed deterministic entropy handling and trusted fixture drift.
- The service authoring suite initially failed 12 tests because trusted plan,
  mission, objective, debt, and participant bindings were not mapped or
  resolved through opaque tokens.
- The existing preload boundary test failed after the public method count moved
  from seven to eleven; its exact-channel assertions were updated.
- A final hostile-content test proved that a relative artifact path embedded in
  Markdown was accepted. The bounded text guard was tightened before GREEN.

## GREEN

Exact focused command from the brief:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts
```

Result: 4 files passed, 126 tests passed, exit 0.

```bash
corepack pnpm --dir apps/desktop check
```

Result: all node, web, and end-to-end TypeScript checks passed, exit 0.

The focused preload boundary suite also passed after it was extended to verify
the four named wrappers and their fixed channels.

## Token Isolation, Expiry, And Capacity

- Production review, option, and revision tokens use 24 random bytes and the
  `chapter_review_`, `chapter_option_`, and `chapter_revision_` prefixes.
- Review bindings retain project key, resolved project root, chapter number,
  purpose, source/review hash, and latest committed chapter. Options are
  purpose-bound to direction, objective, debt, or participant resolution.
- Cross-project, wrong-purpose, re-bound project, changed source, changed latest
  chapter, and expired tokens return a fresh bounded `stale` result.
- Expiry is enforced at 30 minutes. Stores retain at most 200 review bindings
  and 500 revision bindings, evicting the oldest binding at capacity.
- A valid revision token is consumed once. Invalid-scope attempts do not reveal
  or consume another project's binding.

## Contract Leakage Checks

- Strict request schemas reject extra candidate/objective/debt/character IDs,
  paths, hashes, run IDs, schema names, auth/provider/profile fields, and generic
  invoke/file operations before service invocation.
- Public plan and mission reviews contain author-facing text plus opaque review,
  option, item, participant, and revision tokens only. Main resolves mission
  item tokens to trusted IDs; new participants cross the boundary as name and
  role only so the engine remains the ID authority.
- Public text and Markdown reject embedded absolute or relative artifact paths,
  internal ID forms, SHA-256 values, run IDs, and schema filenames. Aggregate
  and per-field byte/count limits are schema-tested.
- Every new handler validates the trusted sender, parses one strict request,
  calls exactly one service method, parses one strict response, and uses only
  its fixed IPC channel. Public stale, blocked, and invalid results expose only
  bounded message keys.

## Active-Operation Checks

- Direction selection, plan save, mission save, and revision adoption reject
  both active generation and the start window with `generation_busy`.
- Planning and drafting starts also reject while an authoring operation holds
  the project slot. Repeated starts and cross-service engine calls continue to
  serialize through the shared project lease.

## Story State Evidence

The Story State suite passed all 11 cases. It asserts byte-identical state after
opaque direction selection, plan revision save/adoption, mission token
resolution/save/adoption, planning and drafting success/failure/cancellation,
invalid-output recovery, and two real service instances sharing the project
lease. Authoring continues to use the trusted engine operations that disallow
Story State writes.

## Self-Review

- Renderer-visible data is schema-parsed at both the service and handler
  boundaries; trusted bindings never enter the preload API.
- Project roots are resolved only from registered project keys. Token checks
  compare both the logical project and its resolved root before use.
- Option purposes are explicit, revision adoption is one-time, and stale checks
  refresh trusted review state before mutating engine artifacts.
- Engine errors are mapped to the finite public outcomes/message keys required
  by the brief; raw errors and raw Codex output are not returned.
- Changes are limited to the Electron authoring boundary and its tests/fixtures.

## Concerns

No blocking concerns. HEAD exposes trusted authoring mutations but not a single
trusted plan-review read facade, so `EngineChapterGateway` validates the public
workspace read first and then reconstructs hidden bindings from main-only
artifacts. Its trusted schemas and review-hash reconstruction must remain in
sync with the engine artifact contract until that read model is exported by the
engine. Existing untracked Playwright and screenshot artifacts remain outside
the commit.

## Fix Round 1

### Status And Commit

Complete on top of `d173d90`. Scoped fix commit subject:
`fix(desktop): harden opaque chapter authoring boundary`.

### RED

- Public token schemas accepted 24-hex payloads.
- A traversal candidate ID and a symlinked `plan_candidates` ancestor allowed
  the gateway to read Markdown outside the expected candidate root.
- Excerpts and other renderer free text accepted generic POSIX/Windows paths,
  unknown relative artifact paths, additional engine IDs, percent/HTML entity
  encodings, `file:` links, and encoded IDs inside HTTPS links.
- Busy and stale-source adoption failures deleted the revision token before the
  gateway failed, preventing retry.
- An unchanged source `charactersToIntroduce` entry was incorrectly added to
  `participatingCharacterIds` after mission adoption.

### GREEN

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts
```

Result: 4 files passed, 148 tests passed, exit 0.

```bash
corepack pnpm --dir apps/desktop check
```

Result: node, web, and end-to-end TypeScript checks passed, exit 0. The root
engine `corepack pnpm build` also passed after the trusted mission edit facade
was extended; generated `dist` files remain ignored and uncommitted.

### Security Fixes

- Candidate IDs are validated as `plan_` plus exactly three digits before path
  construction. Candidate-root ancestry rejects symlinks/non-directories, and
  canonical containment is checked before and after regular-file reads.
- Every renderer-facing prose field, including both excerpts and task errors,
  uses one normalized leakage guard. It covers encoded paths/IDs while keeping
  ordinary `yes/no`, `1/2`, and HTTPS prose usable.
- Public review/option/revision schemas require exactly 48 lowercase hex
  characters after the prefix; production generation remains 24 random bytes.
- Adoption reserves a revision token, commits deletion only after gateway
  success, and releases it on failure. Busy and stale-source failures remain
  retryable; success remains single-use. Revision chapter staleness and
  30-minute expiry have direct tests.
- Main-only participant bindings carry committed/introduced origin. The trusted
  engine edit retains existing introductions without changing their name/role
  or adding their IDs to `participatingCharacterIds`.

### Story State And Boundaries

The Story State suite now passes 12 cases. The new real service/engine
round-trip asserts byte-identical Story State and exact preservation of both
participant arrays. Fixed IPC channels, named preload wrappers, and public
renderer shapes were not widened.

### Concerns

No blocking concerns. The existing synchronization concern remains: the
gateway reconstructs trusted review bindings from engine artifacts until the
engine exports a single trusted read model. Existing untracked Playwright and
screenshot artifacts remain outside this fix commit.

## Fix Round 2

### Status And Commit

Complete on top of `cf433ff`. Scoped fix commit subject:
`fix(desktop): close remaining authoring security gaps`.

### RED

- The fixed three-pass leakage decoder accepted paths and internal artifact
  names after four or more percent/HTML-entity encoding layers, as well as
  backtick, colon-delimited, and standalone `selected_plan.md` forms.
- The broad separator heuristic rejected bounded author prose such as
  `yes/no/maybe` and `actor/goal/stakes`.
- Revision capacity eviction could remove the oldest token while it was
  reserved for adoption; a subsequent busy release could not make it
  retryable. Fully reserved stores also accepted allocations by invalidating
  an in-flight token.

### GREEN

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts
```

Result: 4 files passed, 159 tests passed, exit 0.

```bash
corepack pnpm --dir apps/desktop check
corepack pnpm build
```

Result: desktop node/web/end-to-end TypeScript checks and the root build both
passed, exit 0.

### Leakage Guard

- Leakage normalization now runs to a fixed point with a 16-pass ceiling and
  the existing Markdown-size ceiling. It fails closed if normalization does
  not converge within those bounds.
- The same centralized guard detects prohibited paths, IDs, and known internal
  filenames through nested percent/entity encoding, Markdown backticks, and
  colon-delimited text in every renderer-facing free-text field.
- The imprecise two-separator rule was removed; precise path/artifact patterns
  retain ordinary three-way slash prose while aggregate and per-field bounds
  remain unchanged.

### Revision Capacity

- Allocation at capacity evicts only the oldest unreserved revision. Reserved
  revisions are excluded from expiry and capacity pruning until commit or
  release.
- If all 500 revision entries are reserved, allocation fails with one bounded
  internal error instead of invalidating any adoption.
- Tests reserve the oldest entry at capacity, allocate across projects, force
  a non-mutating busy result, release and retry successfully, then verify that
  success remains single-use. Concurrent and cross-project reservation checks
  remain enforced.

### Story State And Boundaries

The Story State suite passes all 12 cases. Candidate containment, participant
origin, 192-bit token shape, fixed IPC/preload methods, and renderer response
shapes were not changed in this round. Existing untracked Playwright and
screenshot artifacts remain outside the commit.

### Concerns

No blocking concerns. The bounded normalization intentionally rejects text
that still changes after 16 decoding passes; this is a fail-closed public
contract behavior. The existing trusted gateway read-model synchronization
concern from Fix Round 1 remains unchanged.
