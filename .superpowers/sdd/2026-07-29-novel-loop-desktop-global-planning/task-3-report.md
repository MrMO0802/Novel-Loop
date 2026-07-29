# Task 3 Report: Trusted Planning IPC, Preload, and Main Wiring

## Status

Complete.

## Files

- `apps/desktop/src/shared/ipcChannels.ts`
- `apps/desktop/src/shared/desktopApi.ts`
- `apps/desktop/src/main/ipc/registerPlanningHandlers.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/tests/main/planningHandlers.test.ts`
- `apps/desktop/tests/preload/preloadBoundary.test.ts`
- `apps/desktop/tests/e2e/electron-smoke.test.ts`
- Existing renderer test API mocks were extended with the typed planning namespace only; no renderer UI was changed.

## RED Evidence

Command:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/planningHandlers.test.ts tests/preload/preloadBoundary.test.ts
```

Before implementation, the planning handler test failed because
`registerPlanningHandlers` did not exist. The preload boundary test also failed
because `planning` was absent from the exposed `window.novelLoop` API.

## GREEN Evidence

Commands passed after implementation:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/planningHandlers.test.ts tests/preload/preloadBoundary.test.ts
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e -- tests/e2e/electron-smoke.test.ts
git diff --check
```

The desktop test command completed with 22 test files and 237 tests passing.
The built Electron smoke test confirmed the exposed API has exactly the named
`system`, `projects`, `foundation`, and `planning` namespaces, and that
`planning` has only `start`, `get`, `cancel`, and `read`.

## Boundary Self-Review

- The four channels are fixed constants; no renderer-controlled channel names
  are accepted.
- Every handler validates the sender before parsing input or calling the
  service.
- Every request is parsed with its strict Zod request schema before service
  invocation.
- Every response is parsed with its strict Zod response schema before it can
  cross IPC.
- Electron main owns `ProjectPlanningService` and `EnginePlanningGateway`;
  the renderer has no filesystem, shell, Codex, path, project-root, raw-output,
  run, or Story State API.
- Preload has only two runtime imports: `electron` and `ipcChannels`.
  Planning contracts are type-only imports.
- This task does not add generic `invoke`, subscription, filesystem, shell,
  Codex command, or workspace-write exposure.

## Commits

- `feat(desktop): expose trusted global planning IPC`
