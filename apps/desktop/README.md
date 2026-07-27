# Novel Loop Desktop

Novel Loop Desktop is the production Electron foundation for the local-first
Novel Loop authoring product. The current milestone contains a secure desktop
shell, a Chinese-first first-launch readiness flow, and a read-only Codex
availability check.

It does not yet create or open projects, generate chapters, write Story State,
change the chapter queue, commit chapters, roll back snapshots, or restore
archives.

## Architecture Boundary

```text
React renderer
  -> typed contextBridge API
  -> validated Electron IPC
  -> Electron main application service
  -> Novel Loop Engine read-only adapter
```

The renderer receives one named method:

```ts
window.novelLoop.system.getReadiness()
```

The renderer cannot access Node.js, Electron, `ipcRenderer`, the filesystem,
shell commands, environment variables, Codex authentication data, raw Codex
JSONL, project paths, Story State, or generic IPC methods.

Every IPC request and response is validated with Zod in Electron main. The main
window uses context isolation, Chromium sandboxing, disabled Node integration,
web security, denied permission requests, blocked popups, and restricted
navigation.

## Development

From the repository root:

```bash
corepack pnpm install
corepack pnpm desktop:dev
```

Build and verify the desktop package:

```bash
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop verify
```

Run the Electron security smoke after building:

```bash
corepack pnpm --dir apps/desktop test:e2e
```

The normal smoke reports a skip when the host cannot launch Electron securely.
The release gate is intentionally non-skippable:

```bash
corepack pnpm --dir apps/desktop verify:release
```

`verify:release` fails when a usable Chromium sandbox is unavailable. Run it in
a sandbox-capable packaging or CI environment before accepting a distributable
desktop build.

## Ubuntu 24.04 Sandbox Requirement

Electron must start with a working Chromium sandbox. Novel Loop does not use
`--no-sandbox` or `--disable-setuid-sandbox`.

On Linux, the Electron smoke requires either:

- a correctly installed root-owned SUID `chrome-sandbox` helper with mode
  `4755`; or
- a host policy that permits Chromium's unprivileged user-namespace sandbox.

Ubuntu hosts with restricted unprivileged user namespaces and an unprivileged
Electron helper cannot launch the development binary securely. In that case,
the smoke test reports a skip with the sandbox reason. Production packaging
must install or declare an appropriate sandbox policy before the application is
considered distributable.

Useful read-only diagnostics:

```bash
sysctl kernel.unprivileged_userns_clone
sysctl kernel.apparmor_restrict_unprivileged_userns
stat -c '%U %a %n' node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Do not work around a failed sandbox check by adding insecure Electron flags.

## Current Scope

- Secure Electron main, preload, and renderer build separation.
- Strict CSP, permission denial, popup denial, and navigation restriction.
- Schema-validated `SystemReadiness` contract.
- Read-only mapping to the existing Codex execution boundary.
- First-launch states for ready, missing, logged out, warning, and unavailable.
- Unit tests for window policy, navigation, IPC, preload, engine mapping, and UI.
- Playwright Electron security smoke when the host sandbox is usable.

The next milestone should add the read-only project library contract and empty
state. Project writes remain out of scope until their typed main-process
application-service boundary and approval model are designed.
