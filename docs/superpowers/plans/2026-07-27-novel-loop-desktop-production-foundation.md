# Novel Loop Desktop Production Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production Electron foundation for Novel Loop: a runnable Ubuntu desktop shell with a locked-down renderer, a narrow schema-validated preload API, and a read-only Codex readiness flow.

**Architecture:** Add an isolated `apps/desktop` package built by electron-vite. Electron main owns every privileged capability; preload exposes named domain methods only; renderer remains a browser-only React application. A small root engine export maps existing Codex boundary results into a redacted desktop contract without exposing paths, auth data, raw JSONL, shell arguments, or Story State mutation.

**Tech Stack:** Electron 43.2, electron-vite 5, React 19, TypeScript 5.9, Vite 7, Zod 4, Vitest 3, Testing Library, Playwright Electron.

## Global Constraints

- Target Ubuntu 24.04 first; Windows and macOS packaging are not part of this plan.
- Keep the approved Project Library -> Project Space -> Chapter Workspace information architecture.
- Do not connect DeepSeek, OpenAI API, Web UI, or CodexAgentConnector.
- Do not add project writes, chapter generation, Story State mutation, queue mutation, commit, rollback, or snapshot restore.
- Renderer must not import Node.js or Electron modules, read project files, execute shell commands, invoke Codex, construct artifact paths, or receive raw Codex JSONL.
- Use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and `app.enableSandbox()`.
- Do not expose `ipcRenderer`, a generic `invoke`, filesystem paths, environment variables, tokens, auth files, provider output, or internal error codes through preload.
- Validate every IPC request and response with Zod in Electron main.
- Main may call only named application-service methods; it must not interpolate renderer values into shell commands.
- Codex readiness is read-only and must reuse the existing Codex execution boundary.
- All renderer text is Chinese-first and accessed through message keys.
- Preserve the approved status distinction between draft, revision candidate, commit preview, and committed content.
- Source design: `docs/superpowers/specs/2026-07-24-novel-loop-desktop-product-design.md`.
- Approved prototype reference: `prototype/desktop`; production code must not import from it.

---

## Planned File Structure

```text
apps/desktop/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── vitest.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── createMainWindow.ts
│   │   ├── windowPolicy.ts
│   │   ├── navigationPolicy.ts
│   │   ├── ipc/
│   │   │   ├── registerSystemHandlers.ts
│   │   │   └── trustedSender.ts
│   │   └── services/
│   │       ├── SystemReadinessService.ts
│   │       └── EngineSystemReadinessService.ts
│   ├── preload/
│   │   └── index.ts
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── global.d.ts
│   │       ├── i18n/messages.zh-CN.ts
│   │       └── styles/
│   │           ├── tokens.css
│   │           └── base.css
│   └── shared/
│       ├── desktopApi.ts
│       ├── ipcChannels.ts
│       └── systemContract.ts
└── tests/
    ├── main/windowPolicy.test.ts
    ├── main/navigationPolicy.test.ts
    ├── main/systemHandlers.test.ts
    ├── preload/preloadBoundary.test.ts
    ├── renderer/App.test.tsx
    └── e2e/electron-smoke.test.ts

src/desktop/
├── index.ts
└── systemReadiness.ts
```

## Task 1: Secure Electron Shell

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsconfig.node.json`
- Create: `apps/desktop/tsconfig.web.json`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/createMainWindow.ts`
- Create: `apps/desktop/src/main/windowPolicy.ts`
- Create: `apps/desktop/src/main/navigationPolicy.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/styles/tokens.css`
- Create: `apps/desktop/src/renderer/src/styles/base.css`
- Create: `apps/desktop/tests/main/windowPolicy.test.ts`
- Create: `apps/desktop/tests/main/navigationPolicy.test.ts`

**Interfaces:**

- Produces: `createMainWindow(): BrowserWindow`.
- Produces: `createSecureWindowOptions(preloadPath: string): BrowserWindowConstructorOptions`.
- Produces: `installNavigationPolicy(window: BrowserWindow): void`.
- Security invariant: renderer receives no preload API in this task.

- [x] **Step 1: Add the package manifest and build configuration**

`apps/desktop/package.json`:

```json
{
  "name": "@novel-loop/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "check": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test tests/e2e",
    "verify": "pnpm check && pnpm test && pnpm build"
  },
  "dependencies": {
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^24.3.0",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.2",
    "electron": "43.2.0",
    "electron-vite": "5.0.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.2",
    "vite": "^7.3.1",
    "vitest": "^3.2.4"
  },
  "packageManager": "pnpm@10.12.1"
}
```

`electron.vite.config.ts` must define separate main, preload, and React renderer builds. Main and preload use their conventional entry files; renderer root is `src/renderer`.

- [x] **Step 2: Write failing security-policy tests**

`windowPolicy.test.ts` must assert:

```ts
const options = createSecureWindowOptions('/trusted/preload.js');
expect(options.webPreferences).toMatchObject({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload: '/trusted/preload.js'
});
expect(options.show).toBe(false);
```

`navigationPolicy.test.ts` must assert that same-document navigation is allowed, while `https:`, `http:`, `file:` outside the packaged renderer, `javascript:`, and popup creation are denied.

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/windowPolicy.test.ts tests/main/navigationPolicy.test.ts
```

Expected: FAIL because the policy modules do not exist.

- [x] **Step 4: Implement the secure window and navigation policy**

`createSecureWindowOptions()` must set fixed minimum dimensions, delay display until `ready-to-show`, and apply the exact security flags above.

`src/main/index.ts` must:

```ts
app.enableSandbox();
await app.whenReady();
session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
  callback(false);
});
createMainWindow();
```

`installNavigationPolicy()` must deny `setWindowOpenHandler`, prevent untrusted `will-navigate`, and never call `shell.openExternal`.

- [x] **Step 5: Add a restrictive renderer document**

`index.html` must include:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'"
/>
```

`frame-ancestors` is intentionally omitted from the meta policy because
Chromium ignores that directive when it is delivered through a meta element.
Popup denial and renderer navigation policy enforce the desktop window
boundary.

The renderer displays a production-foundation boot message only. It must not import prototype fixtures.

- [x] **Step 6: Verify GREEN**

Run:

```bash
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
```

Expected: all commands exit 0.

- [x] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add secure Electron shell"
```

## Task 2: Typed Preload And Validated IPC

**Files:**

- Create: `apps/desktop/src/shared/systemContract.ts`
- Create: `apps/desktop/src/shared/ipcChannels.ts`
- Create: `apps/desktop/src/shared/desktopApi.ts`
- Create: `apps/desktop/src/main/ipc/trustedSender.ts`
- Create: `apps/desktop/src/main/ipc/registerSystemHandlers.ts`
- Create: `apps/desktop/src/main/services/SystemReadinessService.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/src/global.d.ts`
- Create: `apps/desktop/tests/main/systemHandlers.test.ts`
- Create: `apps/desktop/tests/preload/preloadBoundary.test.ts`

**Interfaces:**

- Produces: `SystemReadinessSchema`.
- Produces: `NovelLoopDesktopApi`.
- Produces: `registerSystemHandlers(service: SystemReadinessService): void`.
- Exposes: `window.novelLoop.system.getReadiness(): Promise<SystemReadiness>`.

- [x] **Step 1: Define the schema-first contract**

`SystemReadinessSchema`:

```ts
export const SystemReadinessSchema = z.object({
  app: z.object({
    name: z.literal('Novel Loop'),
    version: z.string().min(1),
    platform: z.enum(['linux', 'win32', 'darwin'])
  }),
  codex: z.object({
    status: z.enum(['ready', 'not_installed', 'not_logged_in', 'warning', 'unavailable']),
    version: z.string().min(1).nullable(),
    summary: z.string().min(1),
    canRunSmoke: z.boolean()
  }),
  checkedAt: z.string().datetime()
});
```

The response must not include a path, token, environment variable, command, raw output, doctor JSON, run ID, or internal error code.

- [x] **Step 2: Write failing IPC and preload boundary tests**

Tests must prove:

- only `novel-loop:system:get-readiness` exists;
- handler output is parsed by `SystemReadinessSchema`;
- untrusted sender URLs are rejected;
- preload exposes exactly `system.getReadiness`;
- source contains no `ipcRenderer.send`, generic `invoke(channel`, filesystem, shell, Codex, or project write API.

- [x] **Step 3: Verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/main/systemHandlers.test.ts tests/preload/preloadBoundary.test.ts
```

Expected: FAIL because contract and handlers do not exist.

- [x] **Step 4: Implement the named IPC boundary**

Preload may call:

```ts
ipcRenderer.invoke(IPC_CHANNELS.systemGetReadiness)
```

It must not expose `ipcRenderer` or accept a caller-provided channel. Main validates the sender URL and parses the service result before returning it.

- [x] **Step 5: Verify and commit**

Run:

```bash
corepack pnpm --dir apps/desktop verify
```

Expected: exit 0.

```bash
git add apps/desktop
git commit -m "feat(desktop): add typed preload readiness contract"
```

## Task 3: Read-only Engine Readiness Adapter

**Files:**

- Create: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `src/desktop/systemReadiness.ts`
- Create: `src/desktop/index.ts`
- Create: `tests/unit/desktopSystemReadiness.test.ts`
- Create: `apps/desktop/src/main/services/EngineSystemReadinessService.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/tests/main/engineSystemReadinessService.test.ts`

**Interfaces:**

- Produces from engine: `getDesktopSystemReadiness(input?): Promise<DesktopSystemReadiness>`.
- Consumes in desktop main: `EngineSystemReadinessService`.
- Safety: maps existing `checkCodexStatus()` into the redacted desktop contract.

- [x] **Step 1: Write engine mapping tests**

Inject the existing Codex status checker and cover:

- ready binary and login;
- binary missing;
- login missing;
- doctor warning with usable status;
- unexpected boundary failure.

Assertions must prove no `binaryPath`, `doctorJson`, auth, raw output, environment, or command data survives mapping.

- [x] **Step 2: Verify RED**

Run:

```bash
corepack pnpm test -- tests/unit/desktopSystemReadiness.test.ts
```

Expected: FAIL because `src/desktop/systemReadiness.ts` does not exist.

- [x] **Step 3: Implement the read-only engine export**

The adapter calls `checkCodexStatus()` only. It catches known readiness failures and returns author-facing categories; it never calls smoke, `codex exec`, a provider, project storage, or Story State services.

Add:

```json
"exports": {
  "./desktop": {
    "types": "./dist/desktop/index.d.ts",
    "import": "./dist/desktop/index.js"
  }
}
```

Add workspace scripts:

```json
"desktop:dev": "pnpm build && pnpm --dir apps/desktop dev",
"desktop:build": "pnpm build && pnpm --dir apps/desktop build",
"desktop:test": "pnpm --dir apps/desktop test"
```

- [x] **Step 4: Implement the main service**

`EngineSystemReadinessService` depends on the exported engine function and adds only Electron `app.getVersion()` and `process.platform`. It returns data parsed by `SystemReadinessSchema`.

- [x] **Step 5: Verify and commit**

Run:

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test -- tests/unit/desktopSystemReadiness.test.ts
corepack pnpm --dir apps/desktop verify
```

Expected: all commands exit 0.

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml src/desktop tests/unit apps/desktop
git commit -m "feat(desktop): connect read-only Codex readiness"
```

## Task 4: Production First-launch Renderer And Electron Smoke

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main/services/EngineSystemReadinessService.ts`
- Modify: `apps/desktop/src/shared/systemContract.ts`
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Modify: `apps/desktop/src/renderer/src/styles/tokens.css`
- Modify: `apps/desktop/src/renderer/src/styles/base.css`
- Create: `apps/desktop/tsconfig.e2e.json`
- Create: `apps/desktop/tests/renderer/App.test.tsx`
- Create: `apps/desktop/tests/e2e/electron-smoke.test.ts`
- Create: `apps/desktop/playwright.config.ts`
- Create: `apps/desktop/README.md`

**Interfaces:**

- Consumes: `window.novelLoop.system.getReadiness()`.
- Produces: production first-launch loading, ready, warning, not-installed, not-logged-in, and unavailable states.
- Produces: Electron launch smoke proving renderer isolation.

- [x] **Step 1: Write failing renderer tests**

Mock the typed preload API and assert:

- loading announces “正在检查本地创作环境”;
- ready offers “进入作品库”;
- missing binary offers installation guidance without CLI flags;
- login missing offers login guidance without auth paths or tokens;
- doctor warning remains non-blocking when `canRunSmoke=true`;
- unavailable state offers “重新检查”;
- no internal error code, path, JSON, command, run ID, or raw output is rendered.

- [x] **Step 2: Verify RED**

Run:

```bash
corepack pnpm --dir apps/desktop test -- tests/renderer/App.test.tsx
```

Expected: FAIL because the production first-launch states are not implemented.

- [x] **Step 3: Implement the approved first-launch surface**

Port only approved tokens and small primitives from the prototype. Do not import prototype source or fixtures. Keep the interface calm, Chinese-first, keyboard accessible, reduced-motion aware, and centered on one next action.

- [x] **Step 4: Add the Electron isolation smoke**

Launch the built app with Playwright Electron and assert:

```ts
expect(await page.evaluate(() => typeof window.novelLoop)).toBe('object');
expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
expect(await page.evaluate(() => typeof window.process)).toBe('undefined');
```

Also assert that `window.open('https://example.com')` creates no window and navigation remains on the packaged renderer.

- [x] **Step 5: Final verification**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop test:e2e
git diff --check
```

Expected: all commands exit 0.

Verification result on 2026-07-27:

- frozen install, root build, 391 root tests, desktop typecheck, 25 desktop
  tests, and desktop build passed;
- the Playwright Electron command exited 0 but securely skipped its one launch
  test because this Ubuntu host restricts unprivileged user namespaces and the
  local Electron SUID helper is not installed as root mode `4755`;
- no insecure sandbox-disabling flag was added;
- `test:e2e:required` and `verify:release` fail instead of skipping when the
  sandbox is unavailable;
- independent read-only re-review reported zero Critical and zero Important
  findings after the release gate, readiness invariant, bounded timeout, i18n
  summary, and runtime API assertions were added;
- milestone acceptance items 1 and 7 remain environment-blocked until the
  actual Electron launch smoke runs on a host or package with a usable Chromium
  sandbox.

- [x] **Step 6: Commit**

```bash
git add apps/desktop docs/superpowers/plans/2026-07-27-novel-loop-desktop-production-foundation.md
git commit -m "feat(desktop): complete production foundation"
```

## Milestone Acceptance

The Production Desktop Foundation is accepted only when:

1. The Electron app starts on Ubuntu 24.04.
2. Renderer has no Node.js, filesystem, shell, project, Codex, or generic IPC capability.
3. All IPC requests and responses are schema validated in main.
4. Codex readiness is read-only and redacted.
5. No project, chapter, queue, snapshot, or Story State file changes during launch and readiness checks.
6. Production renderer handles all readiness states in author language.
7. Unit, build, type, Electron smoke, and existing root regression commands pass.
8. Independent review reports no Critical or Important security-boundary findings.
