# Desktop Diagnostics-Assisted Revision

Date: 2026-09-28
Status: Spec and inline implementation approved by the user on 2026-09-28.

## Intent

Authors whose submission check fails can request an AI revision without editing
every passage manually. They must still compare and explicitly adopt the result,
run a new check, and separately confirm formal submission.

The user approved this product flow. This document specifies the cross-module
boundary before implementation. It does not authorize a real Codex execution,
automatic adoption, or changes to the user's novel.

## Scope And Alternatives

1. Recommended: an isolated diagnostics-bound draft candidate, using existing
   Codex provider, task patterns, comparison UI, and author-adoption machinery.
   This adds provenance and freshness checks but preserves the existing workflow.
2. Reuse the complete CLI revision loop: rejected because it manages canonical
   chapter output and queue lifecycle, which this action must not touch.
3. Put generated text directly into the editor working copy: rejected because
   this blurs saved edits and unaccepted AI suggestions and can overwrite edits.

This is architectural work: it extends typed desktop interfaces and introduces
a diagnostics-bound candidate lifecycle. No new provider or general-purpose AI
chat subsystem is included.

## Author Experience

On a verified diagnostics failure, retain the issue list and manual-edit option,
and add `让 AI 根据检查结果修订`.

- Explain before starting: an independent version will be generated; current
  text and formal story records will not change.
- Show checking source, generating revision, and validating candidate stages.
  Do not invent a percentage or promise the issues are already resolved.
- Offer cancellation. A late provider response after cancellation cannot become
  an adoptable candidate.
- On completion, show source/candidate comparison and paragraph differences,
  plus AI-provided change reasons labeled as suggestions, not verified fixes.
- Offer `采用此修订`, `拒绝候选`, and return without making a decision.
- Adoption requires confirmation. On success, display the adopted text and
  `重新检查`; do not leave the author wondering whether adoption succeeded.
- Rejection preserves the original and records the decision. It must not leave
  a hidden pending edit that blocks future submission.
- A second click after successful adoption must return the already-applied
  result or a clear completed state, not a misleading unsaved-edit error.

First delivery supports whole-candidate adoption/rejection. Partial acceptance,
automatic repeat-until-pass, and multiple parallel candidates are deferred.

## Trusted Source And Freshness

Only main/application services resolve project roots, diagnostic records, and
artifact paths. Renderer sends an opaque project/task/candidate identifier, not
paths, prompt text assembled from files, provider flags, or approval authority.

Before generation:

1. Require a valid next uncommitted chapter and no incomplete commit recovery.
2. Reject an unadopted editor working copy; show how to adopt or discard it.
3. Read failed diagnostics using the existing provenance-verifying reader.
4. Verify diagnostic source bytes exactly match the current adopted/generated
   draft, and diagnostic context hashes match state, queue, mission, plan, and
   relevant configuration used in that check.
5. If historical diagnostics lack verifiable context hashes, require a fresh
   check. Never bind old evidence to current context by assumption.

Persist a schema-validated source binding for new diagnostic checks where the
existing failed-check artifacts do not already contain sufficient context.
Revalidate the binding before publishing a candidate and again at adoption.
Source/context changes invalidate the candidate; keep it for inspection but
disable adoption and ask for a fresh check.

Use the existing project operation guard/lease conventions. Do not hold the
short desktop mutation lock throughout the network request. Reacquire it for
freshness verification and publication/adoption. Concurrent edits must either
be excluded by the existing lease or detected before publication.

## Engine And Provider Boundary

Add a narrowly scoped desktop revision application service; do not invoke
`runChapterRevisionLoop` or any commit path.

Reuse `LLMClient`, `ProviderFactory`, `PromptService`, Codex read-only execution,
bounded inputs, cancellation semantics, and run/event logging.

Context consists of the exact checked text, verified diagnostic issues,
chapter mission, selected plan, and bounded relevant story context. Instruct
the model to address reported contradictions without inventing unrelated plot,
changing character goals, or weakening the chapter requirements.

Use provider output schema and local Zod validation for candidate text and
change explanations. A syntactically valid candidate is not a passed quality
gate. Diagnostics hard checks remain unchanged and must be run after adoption.

No shell, workspace-write, new providers, automatic conflict repair, historical
recommit, or formal state updates are introduced.

## Artifacts And Lifecycle

Proposed isolated location:

```text
chapters/chapter_XXX/diagnostic_revisions/revision_vN/
  source_binding.json
  source.md
  candidate.md
  candidate.json
  task.json
  disposition.json
```

Define Zod schemas under `src/schemas/` before writing any new JSON artifact.

- Source binding: project/chapter identity, diagnostic run/artifact references,
  exact source and context SHA-256 values, and capture time.
- Candidate: identity, source binding, text hash, bounded change explanations,
  provider run reference, and creation time.
- Task: stage, running/cancel-requested/terminal state, safe error, timestamps.
- Disposition: pending/adopting/adopted/rejected/stale, decision time, adopted
  author revision reference where applicable, and source/candidate hashes.

All paths are main-resolved, contained, and checked against symlink escapes.
Use FileStore/atomic writes and versioned allocation; never overwrite a prior
candidate. Terminal metadata is validated before making a candidate visible.

Before adoption, keep candidates separate from ready author-revision records,
so merely generating a candidate cannot trigger the existing pending-edit gate.
On adoption, use existing author-revision machinery to publish the exact
candidate bytes as the current authored draft. Bind retries to candidate and
adoption provenance, including crash between adoption and disposition write;
do not infer success solely from matching text. An interrupted candidate task
is not automatically retried on restart.

Original drafts, diagnostic evidence, final/patch/commit artifacts, snapshots,
queue, and Story State are untouched by generation, rejection, or adoption.
Only authored-draft selection changes on explicit adoption. Earlier submission
previews become unusable via existing source freshness checks.

## Desktop Integration

Keep the dependency direction:

```text
Renderer -> typed preload -> main application service -> engine facade
```

Expected additions: start/get/cancel/read/adopt/reject candidate operations,
strict request/result schemas, guarded IPC registration, and safe renderer
projections. Reuse the existing project registration, working-copy guard,
task polling, comparison components, and icons instead of adding another shell.

Relevant existing modules:

- `apps/desktop/src/main/submission/ProjectSubmissionService.ts`
- `apps/desktop/src/main/submission/EngineSubmissionGateway.ts`
- `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- `apps/desktop/src/renderer/src/features/submission/ChapterSubmissionView.tsx`
- `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`
- `src/app/desktopSubmissionDiagnostics.ts`
- `src/app/desktopSubmissionSource.ts`
- `src/app/chapterAuthorRevision.ts`
- `src/desktop/chapterAuthoring.ts`

Reuse helpers only where their contracts fit. Do not loosen mission/plan
publication schemas or token scopes to make draft candidates fit implicitly.

## Failure And Recovery

- Stale check: ask to rerun diagnostics, not regenerate from stale evidence.
- Unsaved/unadopted edits: return to editor with a clear resolution action.
- Provider unavailable/usage limit/timeout: preserve source and failure run;
  retry only after a user action, within existing configured provider policy.
- Invalid output: retain safe failure provenance, publish no adoptable candidate.
- Cancelled/interrupted: preserve prior text; never silently resume AI calls.
- Tampered candidate/provenance: block adoption and explain that the revision
  cannot be verified; do not expose raw paths or sensitive provider output.
- New check still fails: retain manual edit and request-another-revision options;
  never bypass the check because the author accepted a candidate.

## Acceptance And Verification

Tests precede implementation and use fake Codex/temporary projects.

1. A failed check exposes the action; infrastructure failure does not masquerade
   as a diagnostics revision opportunity.
2. Generation uses exact current adopted text and verified diagnostic evidence.
3. Pending edits, stale source/context, altered evidence, and unsafe paths block.
4. Success persists schema-valid, hash-bound candidate and run provenance.
5. Success/failure/cancel/reject preserve canonical and authored source bytes.
6. No renderer file access or provider invocation on adoption/rejection.
7. Explicit adoption uses exact candidate bytes, is retry-safe, and returns to
   the correct visible state; restart restores pending candidates safely.
8. A new diagnostics check is required; prior successful preview cannot commit
   the newly adopted candidate, and hard-fail diagnostics still block commit.
9. Electron smoke: failed check -> AI candidate -> compare -> adopt -> recheck;
   also reject, cancel, source-stale, and invalid-output paths.
10. Existing manual editing, submission, old-alternative fix, mock tests, and
    fake Codex regressions pass. No real novel fixtures are mutated.

Validation commands after implementation:

```sh
corepack pnpm build
corepack pnpm check
corepack pnpm --dir apps/desktop check
corepack pnpm test --maxWorkers=2 --reporter=dot
corepack pnpm --dir apps/desktop test --maxWorkers=2
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop test:e2e:required
git diff --check
```

Update root/desktop README to distinguish AI candidate generation, adoption,
rechecking, and formal submission. Rollback of the feature disables the new
entry point while retaining manual editing and all existing candidate evidence.

## Non-Goals

No automatic commit, automatic acceptance, relaxed quality thresholds, real
provider benchmark, novel content modification during development, partial
paragraph acceptance, full application redesign, or repository push.
