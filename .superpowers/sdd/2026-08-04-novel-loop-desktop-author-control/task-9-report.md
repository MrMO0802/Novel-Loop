# Task 9 Implementation Report

## Status

Task 9 implementation and release-quality verification are complete. The
Electron acceptance ran under the host's working secure Chromium sandbox; no
sandbox skip or insecure launch flag was used. Independent review is recorded
separately in the SDD ledger.

## Scope

- Extended the deterministic fake-Codex fixture with three Chinese chapter
  direction titles, a legal provisional participant, bounded mission/plan
  adjustment outputs, and prompt-call recording.
- Added the serial `author-controlled chapter` Electron acceptance flow from
  direction review through draft restart recovery and explicit adoption.
- Fixed the production Electron packaging boundary so the ESM-only
  `novel-loop-engine/author-facing` code is bundled into Electron main while
  `novel-loop-engine/desktop` remains an external dynamic import.
- Fixed a real project-lease race by reading the generated draft before the
  lease-backed working copy and plan, including the post-adoption refresh. The
  refresh now stops after navigation/unmount and cannot continue companion reads.
- Blocked draft confirmation while a mission or direction working copy remains
  open, so an unadopted author edit cannot be silently bypassed.
- Updated Chinese author copy and operator documentation for selection, direct
  editing, bounded AI adjustment, participant repair, comparison, autosave,
  recovery, adoption, and the Phase A stop point.

No DeepSeek, OpenAI API, Web UI, CodexAgentConnector, workspace-write,
diagnostics/commit UI, historical recommit, stale regeneration, or conflict
auto-repair capability was added.

## Acceptance Evidence

The serial Electron test proves this exact sequence:

1. Opens a disposable project and reviews three named Chinese directions.
2. Selects the second, non-recommended direction.
3. Directly edits and adopts that direction after reviewing the downstream
   invalidation warning.
4. Removes all mission participants and proves editor validation blocks the
   invalid working copy. A schema-valid no-participant legacy fixture then
   enters the actual draft-start preflight and is routed to participant repair
   without starting `planning.generate_scene_cards_slim`.
5. Adds and adopts provisional participant `周谨`, regenerates planning, and
   confirms the adopted participant remains in `mission.json`.
6. Generates two scenes and `draft_v1.md`, edits the draft, and waits for the
   Electron application-data autosave.
7. Closes Electron, reopens it with the same userData directory, explicitly
   continues the recovered working copy, and adopts the edit.

The test computes SHA-256 digests from bytes and asserts:

- `state/story_state.json` after adoption equals its pre-authoring hash;
- `planning/chapter_queue.json` after adoption equals its `draft_ready` hash;
- `chapters/chapter_001/draft_v1.md` after adoption equals its original
  generated hash and byte content;
- `latestCommittedChapter` remains `0`;
- `chapters/chapter_001/author_revisions/draft_revision_v1.md` exists and equals
  the recovered author text exactly.

The disposable project is removed after the assertions, so no test-generated
project, run, raw Codex output, or hash fixture is retained in the repository.

## Provider And Renderer Boundary Evidence

- All generation uses the local deterministic fake binary selected through
  `NLE_CODEX_BIN`; the fixture rejects unknown commands, prompt IDs, schemas,
  prompt replacement, dangerous instructions, and unsafe execution flags.
- The fake records every provider-process attempt before prompt validation.
  Exactly one scene-card attempt is recorded, followed by exactly two
  `production.write_scene` attempts. Empty-roster preflight records no provider
  attempt at all.
- Every fake invocation requires sandbox `read-only` and approval policy
  `never`.
- Renderer chapter methods remain the exact allowlisted preload API.
- Renderer payload assertions cover inspection, plan, draft, working-copy, and
  adjustment start/get task results. Recursive key/value checks reject generic
  filesystem paths on POSIX, Windows, and UNC forms; hashes; raw candidate IDs;
  run/schema/provider/model/prompt/raw/auth metadata; JSONL; and secret fields.
- Renderer `process` and `require` remain unavailable.
- Every Playwright Electron launch explicitly sets `chromiumSandbox: true`.
  The smoke reads the actual Electron child-process arguments and rejects
  `--no-sandbox` and `--disable-setuid-sandbox`; exact secure BrowserWindow
  preferences remain pinned by `windowPolicy.test.ts`.

## Verification

Release-quality matrix:

- `corepack pnpm install --frozen-lockfile`: passed; lockfile unchanged, pnpm
  `10.12.1`.
- `corepack pnpm build`: passed.
- `corepack pnpm check`: passed.
- `corepack pnpm check:diff`: passed.
- `corepack pnpm test`: **199 files, 655 tests passed** in `230.10s`.
- `corepack pnpm --dir apps/desktop check`: passed all Node, renderer, and E2E
  TypeScript configurations.
- `corepack pnpm --dir apps/desktop test`: **36 files, 584 tests passed** in
  `43.59s`.
- `corepack pnpm desktop:build`: passed; Electron main, preload, and renderer
  production bundles generated successfully.
- `corepack pnpm --dir apps/desktop test:e2e`: **9 tests passed** in `44.3s`
  with the secure Chromium sandbox required for all three Electron launch
  sites.
- Focused security smoke stability loop: **20/20 passed** after the launch and
  assertion hardening. Before the fix, the old
  `ElectronApplication.evaluate()` bridge reproduced the Playwright
  `Resulting promise was garbage collected` failure in **2/5 runs**.

The focused author-control acceptance also passed independently before the full
suite. Earlier CommonJS `ERR_PACKAGE_PATH_NOT_EXPORTED`, chapter-read lease
race, and Electron main-evaluation bridge failures were reproduced, fixed, and
superseded by the passing results above. The security smoke no longer depends
on the nondeterministic Playwright main-process promise bridge.

## Review Round 1 Closure

The first independent review found four gaps, all covered by bounded fixes:

- empty-participant acceptance now reaches the real draft-start preflight and
  uses attempt-level fake-provider logging;
- renderer boundary assertions cover plan and adjustment task payloads with
  generic recursive cross-platform leakage detection;
- post-adoption reads are fenced by the workspace request generation after
  navigation/unmount;
- operator documentation scopes queue immutability to editing/recovery/adoption
  after `draft_ready`, while Story State remains immutable across the full flow.

## Operator Documentation

The root and desktop READMEs now document:

- generated source, unadopted working copy, candidate/comparison, and adopted
  author draft states;
- direction selection, direct edit, bounded AI adjustment, comparison, and
  explicit adoption;
- participant repair without weakened character-reference validation;
- autosave as Electron application data without user-specific paths;
- generated `draft_v1.md` versus the versioned adopted author revision;
- `corepack pnpm desktop:dev`, Ubuntu inotify watcher-limit recovery, and the
  separate secure Electron sandbox requirement;
- the Phase A stop point and complete unsupported scope.

Story Foundation and global planning are accurately described as generated,
read-only review surfaces. No editing capability is claimed for either.

## Phase A Limitations

The desktop workflow stops at an explicitly adopted author draft. It does not
run diagnostics, create canonical `final.md` or `canon_patch.json`, preview or
approve Story State mutations, create commit snapshots, commit a chapter, or
advance `latestCommittedChapter`.
