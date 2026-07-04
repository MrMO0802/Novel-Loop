# M20 Release Candidate Checklist

This checklist is for the deterministic mock release candidate. It does not require a real provider key and does not start a Web UI.

## Clean Start

```bash
corepack pnpm clean:demo
corepack pnpm clean:test
corepack pnpm clean:generated
```

## Required Verification

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm novel-loop audit demo-novel --strict
corepack pnpm novel-loop artifacts demo-novel --refresh
corepack pnpm novel-loop runs demo-novel
corepack pnpm novel-loop verify-snapshots demo-novel
```

## Mock Demo Release Candidate Flow

```bash
corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible demo-novel --provider mock
corepack pnpm novel-loop plan-global demo-novel --provider mock
corepack pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop validate demo-novel
```

## Long Project Stress Fixture

```bash
corepack pnpm novel-loop stress-fixture stress-fixture --chapters 40 --runs-per-chapter 2
corepack pnpm novel-loop artifacts stress-fixture --refresh
corepack pnpm novel-loop audit stress-fixture --strict --fix-index
```

## Retention And Compaction

Preview first:

```bash
corepack pnpm novel-loop retention demo-novel --keep-runs 50
corepack pnpm novel-loop compact-provenance demo-novel --max-events-per-run 200
```

Apply only after reviewing the preview:

```bash
corepack pnpm novel-loop retention demo-novel --keep-runs 50 --apply
corepack pnpm novel-loop compact-provenance demo-novel --max-events-per-run 200 --apply
```

## Release Notes

- Mock provider must remain deterministic.
- Story State must only change through canon patch commit, rollback, or explicitly confirmed recommit.
- Retention must not delete canonical Story State or chapter artifacts.
- Provenance compaction must preserve a report and keep original oversized event logs as `events.full.ndjson`.
