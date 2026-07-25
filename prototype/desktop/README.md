# Novel Loop Desktop Prototype

This is a fixture-driven browser prototype for author UX validation. It demonstrates approved product flows with controlled Chinese fixture data only.

## Safety Boundary

The prototype does not connect to Electron, Novel Loop Engine, Codex, project files, browser storage, Story State, provider services, or production rendering. It does not read or write canonical novel data. Formal commit and recovery actions are simulations.

## Prerequisites

- Node.js with Corepack enabled
- pnpm 10.12.1, provided through Corepack
- Playwright Chromium for browser checks: `corepack pnpm exec playwright install chromium`

## Commands

```bash
corepack pnpm --dir prototype/desktop install --frozen-lockfile
corepack pnpm --dir prototype/desktop dev
corepack pnpm --dir prototype/desktop check
corepack pnpm --dir prototype/desktop test
corepack pnpm --dir prototype/desktop build
corepack pnpm --dir prototype/desktop test:visual
```

The visual suite owns a local Vite preview at `http://127.0.0.1:4178`, runs at 1440 x 900 and 1024 x 720, and writes failure artifacts under `/tmp/novel-loop-desktop-playwright` rather than the repository.

## Routes

- `/setup?state=ready` and `/setup?state=missing`: readiness fixtures
- `/library`: Project Library
- `/new`: New Novel wizard
- `/project/rain-radio`: Project Overview
- `/project/rain-radio/chapter/2`: Chapter Workspace
- `/project/rain-radio/chapter/2/review`: Diagnostics
- `/project/rain-radio/chapter/2/revision`: Revision comparison
- `/project/rain-radio/chapter/2/commit-preview`: Commit preview
- `/project/rain-radio/story-record`: Story Record
- `/tasks?recovery=timeout` and `/tasks?recovery=crash`: recovery fixtures

## Keyboard And Accessibility

The visual checks cover supported desktop reflow, horizontal overflow, visible controls, keyboard focus, dialog focus return, reduced motion, text-labelled diffs, and accessible icon buttons. Keyboard shortcuts include `Ctrl+K` for the command palette, `Ctrl+P` for the current chapter, and `Ctrl+Shift+Enter` for Focus Mode.

Manual validation remains necessary for 200 percent zoom/reflow, Chinese IME composition in the chapter editor, native tooltip presentation, and assistive-technology reading order. Run these checks at the required 1440 x 900 and 1024 x 720 viewports before an invited-author session.

## Known Limitations

All content, task states, diagnostics, recovery outcomes, and formal commits are controlled fixtures. There is no persistence, engine invocation, provider call, project-file access, real Story Record update, or native desktop shell.

See [the invited-author usability script](../../docs/product/novel-loop-prototype-test-script.md) for session setup and the ten task prompts.
