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
  lease-backed working copy and plan, including the post-adoption refresh.
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
4. Removes all mission participants and proves validation blocks before the
   `planning.generate_scene_cards_slim` provider stage.
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
- Exactly one scene-card prompt is recorded, followed by exactly two
  `production.write_scene` prompts. Participant repair records no scene-card
  provider call.
- Every fake invocation requires sandbox `read-only` and approval policy
  `never`.
- Renderer chapter methods remain the exact allowlisted preload API.
- Renderer payload assertions reject filesystem paths, hashes, run IDs, schema
  names, raw JSONL/provider output, and auth/token-file fields.
- Renderer `process` and `require` remain unavailable.

## Verification

Release-quality matrix:

- `corepack pnpm install --frozen-lockfile`: passed; lockfile unchanged, pnpm
  `10.12.1`.
- `corepack pnpm build`: passed.
- `corepack pnpm check`: passed.
- `corepack pnpm check:diff`: passed.
- `corepack pnpm test`: **199 files, 655 tests passed** in `237.58s`.
- `corepack pnpm --dir apps/desktop check`: passed all Node, renderer, and E2E
  TypeScript configurations.
- `corepack pnpm --dir apps/desktop test`: **36 files, 582 tests passed** in
  `40.88s`.
- `corepack pnpm desktop:build`: passed; Electron main, preload, and renderer
  production bundles generated successfully.
- `corepack pnpm --dir apps/desktop test:e2e`: **8 tests passed** in `37.4s`.

The focused author-control acceptance also passed independently before the full
suite. An earlier CommonJS `ERR_PACKAGE_PATH_NOT_EXPORTED` startup failure and
the chapter-read lease race were reproduced, fixed, and superseded by the
passing results above.

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
