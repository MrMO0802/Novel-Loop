# Novel Loop Engine v2.5.0-rc.1 Release Candidate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the accepted M26.5 / v2.4.0 Codex single- and multi-chapter pilot baseline into a reproducible `v2.5.0-rc.1` release candidate.

**Architecture:** Keep the current local-first TypeScript CLI architecture. Freeze and document the accepted mock/fake-Codex baseline, keep real Codex multi-chapter behavior explicitly pilot-only, and add only narrow release hardening. Do not introduce DeepSeek, OpenAI API work, Web UI, CodexAgentConnector, or expanded real-Codex stability promises.

**Tech Stack:** Node.js 20+, TypeScript, pnpm, Vitest, Commander, Zod, local filesystem artifacts, local Codex CLI boundary.

---

## Release Scope

Stable RC scope:

- Mock provider multi-chapter production and commit.
- Fake Codex regression suite for single- and multi-chapter pilot flows.
- Local Codex CLI read-only boundary.
- `codex-text` dry-run/draft and controlled commit for the normal next uncommitted chapter.
- Codex single-chapter smoke and controlled multi-chapter pilot as operator-run workflows.
- Runtime benchmark stabilization from M26.5 as release confidence tooling.
- Audit, run/event provenance, snapshot, artifact index, and rollback/recommit tooling already in baseline.

Explicitly out of scope:

- DeepSeek.
- OpenAI API production rollout.
- Web UI.
- CodexAgentConnector.
- Real Codex historical recommit.
- Real Codex stale regeneration commit.
- Real Codex conflict auto-repair.
- Long-form literary quality scoring as a production promise.
- M27 output/runtime optimization features as release commitments.

Important baseline wording:

- Current RC state must be described as **M26.5 / v2.4.0 baseline**.
- Release version is **2.5.0-rc.1**.
- Real Codex multi-chapter remains **pilot / experimental**, not a stable production guarantee.

---

## Milestone 1: RC Baseline Freeze And Operator Docs

**Workload:** 1 day

### Goal

Freeze the accepted baseline as `2.5.0-rc.1`, align user-facing version/docs, and add operator guidance for Codex pilot workflows before any CI/package work.

### Files / Modules

- Modify: `package.json`
- Modify: `src/cli/program.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v2.5.0-rc.1-release-checkpoint.md`
- Create: `docs/operations/codex-pilot-runbook.md`
- Modify: `Plan.md`

### Tasks

- [x] Set `package.json` version to `2.5.0-rc.1`.
- [x] Set Commander CLI version in `src/cli/program.ts` to `2.5.0-rc.1`.
- [x] Update README top-level status to M26.5 / v2.4.0 baseline.
- [x] Remove or demote M27 optimization language from README release status and current milestone sections.
- [x] Add a short README link to `docs/operations/codex-pilot-runbook.md`.
- [x] Add `CHANGELOG.md` entry for `v2.5.0-rc.1` and make it clear this is an RC based on M26.5 / v2.4.0 baseline.
- [x] Add release checkpoint doc with included/excluded scope, required verification, and known limitations.
- [x] Add Codex pilot runbook covering health status, doctor warning, progressive benchmark, failure handling, resume guidance, and non-goals.
- [x] Confirm `git status --short` still shows no unexpected generated runtime artifacts outside ignored `projects/`.

### Acceptance Criteria

- `package.json` and `novel-loop --version` both report `2.5.0-rc.1`.
- README and release checkpoint describe current status as M26.5 / v2.4.0 baseline, not current M27.
- Real Codex multi-chapter is documented as pilot / experimental.
- Operator docs explain that real Codex smoke is not a required CI gate.
- No DeepSeek, OpenAI API, Web UI, or CodexAgentConnector scope is added.

### Verification Commands

```bash
corepack pnpm build
corepack pnpm novel-loop --version
corepack pnpm novel-loop --help
git diff --check
git status --short
```

### Risks And Rollback

Risks:

- Existing M27 working-tree changes may still be present. Milestone 1 must not market them as RC scope.
- Version changes may require tests to be updated if any test asserts CLI version.

Rollback:

```bash
git restore package.json src/cli/program.ts README.md CHANGELOG.md
rm -f docs/releases/v2.5.0-rc.1-release-checkpoint.md docs/operations/codex-pilot-runbook.md
git restore Plan.md
```

---

## Milestone 2: CI Gate

**Workload:** 1 day

### Goal

Add automated release gates for install, typecheck, build, and test without requiring local Codex login or real provider credentials.

### Files / Modules

- Create: `.github/workflows/ci.yml`
- Modify: `README.md`
- Optional Modify: `package.json`

### Tasks

- [x] Add required CI job `build-and-test`.
- [x] CI should use Node.js 20 and Corepack.
- [x] Run `corepack pnpm install --frozen-lockfile`.
- [x] Run `corepack pnpm exec tsc -p tsconfig.json --noEmit`.
- [x] Run `corepack pnpm build`.
- [x] Run `corepack pnpm test`.
- [x] Add separate `dependency-audit` job with `continue-on-error: true` or non-required status.
- [x] Do not run real Codex smoke, real Codex benchmark, DeepSeek, or OpenAI API commands in required CI.
- [x] Document CI scope in README.

### Acceptance Criteria

- Required CI does not depend on network except dependency installation.
- Required CI does not require API keys or Codex login.
- `pnpm audit` cannot block the main release path due to transient registry/transitive dependency noise.
- CI commands are reproducible locally.

### Verification Commands

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm exec tsc -p tsconfig.json --noEmit
corepack pnpm build
corepack pnpm test
corepack pnpm audit --audit-level high
```

### Risks And Rollback

Risks:

- Full Vitest suite is large and may need CI timeout tuning.
- `pnpm audit` may require registry/network access.

Rollback:

```bash
rm -f .github/workflows/ci.yml
git restore README.md package.json
```

---

## Milestone 3: Package Release Hygiene

**Workload:** 1 day

### Goal

Make package output predictable and avoid publishing local runtime artifacts or unnecessary internal test files.

### Files / Modules

- Modify: `package.json`
- Modify: `README.md`
- Optional Create: `.npmignore`

### Tasks

- [x] Add `prepack` script that runs `corepack pnpm build`.
- [x] Add `files` whitelist in `package.json`.
- [x] Include runtime-required assets: `dist/`, `prompts/`, `schemas/`, `examples/`, `fixtures/`, `benchmarks/`, `README.md`, `CHANGELOG.md`, `.env.example`.
- [x] Exclude `projects/`, `.env`, `tests/`, `docs/superpowers/`, raw Codex output, run artifacts, snapshots, audit outputs, and local generated projects.
- [x] Verify `dist/cli/index.js` is included.
- [x] Verify prompt/schema assets needed by CLI are included.

### Acceptance Criteria

- `npm pack --dry-run --json` includes `dist/cli/index.js`.
- Pack output does not include generated `projects/` or secrets.
- Pack output does not include `tests/` unless explicitly chosen for source distribution.
- The package can still run `node dist/cli/index.js --help`.

### Verification Commands

```bash
corepack pnpm build
npm pack --dry-run --json
node dist/cli/index.js --help
node dist/cli/index.js --version
```

### Risks And Rollback

Risks:

- A strict package whitelist may omit prompt fixtures or schemas used at runtime.

Rollback:

```bash
git restore package.json README.md .npmignore
```

---

## Milestone 4: Commit Safety Journal

**Workload:** 2-3 days

### Goal

Reduce partial commit ambiguity by adding a small commit journal and audit detection. This is P1 high-risk hardening, not a broad transaction refactor.

### Files / Modules

- Modify: `src/app/chapterCommit.ts`
- Modify: `src/app/codexControlledCommit.ts`
- Modify: `src/app/projectAudit.ts`
- Modify: `src/schemas/commitReport.ts` or create focused journal schema in `src/schemas/`
- Modify: `src/schemas/index.ts`
- Add/Modify tests under `tests/e2e/`

### Tasks

- [x] Add schema for `commit_journal_vN.json`.
- [x] Write journal phase `prepared` before Story State write.
- [x] Update journal after Story State write, after snapshot, after report, and after queue commit.
- [x] Keep journal append/versioned; never overwrite old commit reports.
- [x] Add audit issue for incomplete journal.
- [x] Add test for successful mock commit writing completed journal.
- [x] Add failure-injection test where state write or post-state phase fails and audit reports incomplete journal.
- [x] Apply equivalent journal behavior to Codex controlled commit or record a compatible journal adapter.

### Acceptance Criteria

- Normal mock commit writes completed journal.
- Normal Codex controlled commit still passes fake-Codex regression.
- Failure during commit leaves enough journal information for operator diagnosis.
- `audit --strict` detects incomplete commit journal.
- Existing mock three-chapter demo and Codex fake pilot tests pass.

### Verification Commands

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm clean:demo
corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible demo-novel --provider mock
corepack pnpm novel-loop plan-global demo-novel --provider mock
corepack pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop validate demo-novel
corepack pnpm novel-loop audit demo-novel --strict --fix-index
```

### Risks And Rollback

Risks:

- Additional write points may surface existing partial-failure assumptions.
- Audit may flag old projects unless journal checks are version-aware.

Rollback:

```bash
git restore src/app/chapterCommit.ts src/app/codexControlledCommit.ts src/app/projectAudit.ts src/schemas src/schemas/index.ts tests/e2e
```

---

## Milestone 5: Lightweight Quality Gate

**Workload:** 1 day

### Goal

Add a local non-invasive quality script without introducing broad lint churn.

### Files / Modules

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

### Tasks

- [x] Add `check` script that runs TypeScript no-emit check.
- [x] Add `check:diff` or document `git diff --check`.
- [x] Wire `corepack pnpm check` into CI if it is purely deterministic.
- [x] Do not introduce ESLint unless it passes without large unrelated edits.

### Acceptance Criteria

- `corepack pnpm check` passes.
- No large formatting-only diff.
- Existing build/test behavior is unchanged.

### Verification Commands

```bash
corepack pnpm check
git diff --check
corepack pnpm test
```

### Risks And Rollback

Risks:

- Adding ESLint may create a large remediation queue.

Rollback:

```bash
git restore package.json .github/workflows/ci.yml README.md
```

---

## Final RC Verification

Run after all P0/P1 milestones:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm exec tsc -p tsconfig.json --noEmit
corepack pnpm test
corepack pnpm clean:demo
corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible demo-novel --provider mock
corepack pnpm novel-loop plan-global demo-novel --provider mock
corepack pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop validate demo-novel
corepack pnpm novel-loop audit demo-novel --strict --fix-index
npm pack --dry-run --json
```

Optional local Codex pilot verification, not CI-required:

```bash
corepack pnpm novel-loop codex status
corepack pnpm novel-loop providers inspect codex-text
corepack pnpm run demo:codex-single-chapter
corepack pnpm run demo:codex-multi-chapter
```
