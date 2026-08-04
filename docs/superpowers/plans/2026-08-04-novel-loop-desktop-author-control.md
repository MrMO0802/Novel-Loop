# Novel Loop Desktop Author Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Phase A desktop chapter loop in which authors can choose a chapter direction, edit or ask Codex to adjust the mission and selected plan, repair missing participants, edit and recover the draft, and explicitly adopt each revision without changing Story State.

**Architecture:** Keep the renderer unprivileged and author-facing. The renderer sends bounded content plus opaque review/revision tokens through a typed preload API; Electron main resolves tokens and project roots; engine services validate schemas, acquire the existing project operation lease, archive invalidated uncommitted outputs, and perform atomic writes through `FileStore`. Generated sources and working copies remain separate, and only an explicit adoption changes an active chapter artifact or queue stage.

**Tech Stack:** Node.js 20+, TypeScript, Zod, Electron, React, Vite/electron-vite, Vitest, Testing Library, Playwright, Commander-based Novel Loop Engine, local read-only `CodexTextProvider`.

## Global Constraints

- Phase A stops at editable `draft_v1.md`; do not add desktop diagnostics, final approval, canon patch, snapshot, or commit behavior.
- Do not add DeepSeek, OpenAI API, Web UI, CodexAgentConnector, workspace-write, historical recommit, stale regeneration, or conflict auto-repair.
- Renderer code must not receive absolute paths, raw engine candidate IDs, hashes, schema names, run IDs, auth data, raw Codex output, Node APIs, filesystem APIs, or shell/Codex command access.
- Codex remains local CLI only, sandbox `read-only`, approval policy `never`, with no workspace write and no Story State commit capability.
- Every new JSON artifact is defined by Zod before it is written; every durable project write uses `FileStore` and atomic replacement.
- Saving a working copy never invalidates downstream artifacts; only explicit adoption can change active artifacts or queue state.
- Adoption must reject stale source tokens, committed chapters, changed `latestCommittedChapter`, and concurrent project operations while preserving the working copy.
- Invalidation must retain or archive old uncommitted artifacts; it must never delete committed artifacts or alter live Story State.
- Chinese UI must not display English fallback text such as `Untitled Plan`.
- Keep the existing Electron security boundary: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, denied permissions, denied popups, and denied external navigation.
- Preserve unrelated working-tree files. In particular, do not add `.playwright-mcp/`, `novel-loop-desktop-readiness-ready.png`, or `novel-loop-desktop-readiness-unavailable.png` to a commit.

---

## File Map

### Engine and schemas

- `src/schemas/chapterAuthorRevision.ts`: schema-first records for revisions, selections, invalidation, and active author draft resolution.
- `src/app/chapterAuthorRevision.ts`: version allocation, source hashing, durable revision storage, bounded archive copying, adoption, and queue transitions.
- `src/app/chapterAuthorAdjustment.ts`: bounded mission/plan Codex adjustment calls that produce unadopted revision candidates.
- `src/app/chapterReferenceValidation.ts`: participant-set validation shared by mission and scene-card generation.
- `src/app/chapterPlanning.ts`: localized candidate artifacts, mission participant validation, and durable provider titles.
- `src/app/chapterDrafting.ts`: participant preflight before any scene-card provider call.
- `src/desktop/chapterWorkspace.ts`: author-facing review projection and localized legacy fallback.
- `src/desktop/chapterAuthoring.ts`: narrow trusted engine facade for direction selection, save, adjust, adopt, and draft resolution.
- `src/desktop/index.ts`: exports only the narrow desktop authoring functions and types.

### Codex output boundary

- `prompts/codex-text/planning/plan_chapter_mission_slim.md`: requires a legal participant roster when no committed character exists.
- `prompts/codex-text/planning/adjust_chapter_mission_slim.md`: bounded mission-adjustment prompt.
- `prompts/codex-text/planning/adjust_plan_candidate_slim.md`: bounded selected-plan adjustment prompt.
- `schemas/codex-output/slim/planning.chapter_mission.slim.schema.json`: optional participating committed character IDs plus provisional introductions.
- `schemas/codex-output/slim/planning.chapter_mission_adjustment.slim.schema.json`: mission adjustment output shape.
- `schemas/codex-output/slim/planning.plan_adjustment.slim.schema.json`: plan adjustment output shape.
- `src/providers/codex/schemas.ts`: descriptors for the two new output schemas.
- `src/providers/codex/normalizers.ts`: engine-owned IDs and normalized mission/plan adjustment outputs.

### Electron main, preload, and contracts

- `apps/desktop/src/shared/chapterContract.ts`: strict author-facing requests/responses and opaque tokens.
- `apps/desktop/src/shared/desktopApi.ts`: named chapter authoring methods only.
- `apps/desktop/src/shared/ipcChannels.ts`: fixed IPC channel names.
- `apps/desktop/src/main/chapter/ChapterReviewTokenStore.ts`: project-bound, expiring option/revision token resolution.
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`: atomic autosave storage below Electron `userData`.
- `apps/desktop/src/main/chapter/EngineChapterGateway.ts`: trusted bridge to engine authoring functions.
- `apps/desktop/src/main/chapter/ProjectChapterService.ts`: project lookup, one-operation rule, token binding, and natural error mapping.
- `apps/desktop/src/main/ipc/registerChapterHandlers.ts`: trusted-sender and request/response schema validation.
- `apps/desktop/src/preload/index.ts`: narrow typed methods; no generic invoke or file APIs.
- `apps/desktop/src/main/index.ts`: supplies the `userData` working-copy root and token store.

### Renderer

- `apps/desktop/src/renderer/src/features/chapter/ChapterDirectionChooser.tsx`: peer direction comparison and selection.
- `apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx`: structured mission/participant editor.
- `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`: original/candidate comparison and explicit adoption.
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`: Markdown/plain-text editing, autosave state, and recovery.
- `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`: integrates direction, mission, plan, invalidation, and adjustment flows.
- `apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx`: integrates generated/adopted draft and recovered working copy.
- `apps/desktop/src/renderer/src/features/chapter/ChapterDraftGenerationView.tsx`: participant-repair routing.
- `apps/desktop/src/renderer/src/styles/chapter.css`: stable editor, comparison, status, and responsive layout.
- `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`: all new Chinese labels and recovery copy.

---

### Task 1: Durable localized plan candidates

**Files:**
- Modify: `src/providers/codex/normalizers.ts`
- Modify: `src/schemas/chapterPlanning.ts`
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/desktop/chapterWorkspace.ts`
- Modify: `schemas/codex-output/slim/planning.plan_candidates.slim.schema.json`
- Test: `tests/providers/codexNormalizers.test.ts`
- Test: `tests/integration/chapterPlanningDryRun.test.ts`
- Test: `tests/unit/desktopChapterWorkspace.test.ts`
- Test: `tests/unit/schemas/coreSchemas.test.ts`

**Interfaces:**
- Consumes: `PlanCandidateSchema`, `expectedPlanCandidateId(chapterNumber, ordinal)`, `FileStore.writeText()`.
- Produces: `formatPlanCandidateMarkdown(title: string, markdown: string): string` and `localizedPlanTitle(markdown: string, ordinal: number): string`.
- Produces invariant: candidate files begin with exactly one `# <provider title>` heading and have engine-owned IDs `plan_001`, `plan_002`, and so on.

- [ ] **Step 1: Preserve the existing failing normalizer regression test and add title-format tests**

Add these assertions to the current uncommitted normalizer regression and planning integration tests:

```ts
expect(result.candidates.map((candidate) => candidate.id)).toEqual([
  'plan_001',
  'plan_002',
  'plan_003'
]);

const first = await fileStore.readText(
  paths.chapterArtifact(1, 'plan_candidates', 'plan_001.md')
);
expect(first).toMatch(/^# 遗物中的异常报告\n/);
expect(first.match(/^# /gm)).toHaveLength(1);
```

Add a legacy desktop projection test:

```ts
expect(review.available && review.alternatives.map(({ title }) => title))
  .toEqual(['方案二', '方案三']);
expect(JSON.stringify(review)).not.toContain('Untitled Plan');
```

Add schema assertions that whitespace-only titles and titles over 240 characters are rejected by local Zod validation and by the slim Codex output schema.

- [ ] **Step 2: Run the focused tests and verify the title assertions fail**

Run:

```bash
corepack pnpm exec vitest run \
  tests/providers/codexNormalizers.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/unit/schemas/coreSchemas.test.ts
```

Expected: the ID normalization assertion passes with the existing dirty-tree fix; heading/title assertions fail because candidate Markdown currently contains only `candidate.markdown` and desktop falls back to `Untitled Plan`.

- [ ] **Step 3: Format candidate Markdown and localize legacy fallback**

Implement title formatting in `src/app/chapterPlanning.ts`:

```ts
export function formatPlanCandidateMarkdown(
  title: string,
  markdown: string
): string {
  const safeTitle = title.replace(/\s+/gu, ' ').trim().slice(0, 240);
  const lines = markdown.trim().split(/\r?\n/u);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent >= 0 && /^#\s+\S/u.test(lines[firstContent]!)) {
    lines.splice(firstContent, 1);
  }
  const body = lines
    .map((line) => /^#\s+\S/u.test(line) ? `#${line}` : line)
    .join('\n')
    .trim();
  return body.length > 0
    ? `# ${safeTitle}\n\n${body}\n`
    : `# ${safeTitle}\n`;
}
```

Extend `ValidatedPlanCandidate` with `title: string`, populate it from the validated provider candidate, and write `formatPlanCandidateMarkdown(candidate.title, candidate.markdown)` as both `candidate.markdown` and the file content used by ranking.

Change `PlanCandidateSchema.title` to `z.string().trim().min(1).max(240)` and apply `minLength: 1` / `maxLength: 240` to the slim output schema. This guarantees `safeTitle` cannot be empty after validation.

Replace the English fallback in `src/desktop/chapterWorkspace.ts`:

```ts
function localizedPlanTitle(markdown: string, ordinal: number): string {
  const heading = markdown.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line));
  return heading?.replace(/^#\s+/u, '').trim()
    || `方案${['一', '二', '三', '四', '五'][ordinal - 1] ?? ordinal}`;
}
```

Pass the ranking order into this helper for selected and alternative candidates. Keep provider titles as content and internal candidate IDs out of the desktop result.

- [ ] **Step 4: Run focused and compatibility tests**

Run:

```bash
corepack pnpm exec vitest run \
  tests/providers/codexNormalizers.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/unit/schemas/coreSchemas.test.ts \
  tests/integration/chapterNarrativeReferences.test.ts
corepack pnpm build
```

Expected: all tests pass; candidate titles are Chinese/provider-defined; no Story State fixture changes.

- [ ] **Step 5: Commit only the candidate identity/title change**

```bash
git add \
  src/providers/codex/normalizers.ts \
  src/schemas/chapterPlanning.ts \
  src/app/chapterPlanning.ts \
  src/desktop/chapterWorkspace.ts \
  schemas/codex-output/slim/planning.plan_candidates.slim.schema.json \
  tests/providers/codexNormalizers.test.ts \
  tests/integration/chapterPlanningDryRun.test.ts \
  tests/unit/desktopChapterWorkspace.test.ts \
  tests/unit/schemas/coreSchemas.test.ts
git commit -m "fix(chapter): preserve localized plan identities"
```

---

### Task 2: Schema-first author revision storage

**Files:**
- Create: `src/schemas/chapterAuthorRevision.ts`
- Create: `src/app/chapterAuthorRevision.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/unit/chapterAuthorRevisionSchemas.test.ts`
- Test: `tests/integration/chapterAuthorRevisionStore.test.ts`

**Interfaces:**
- Consumes: `FileStore`, `ProjectPaths`, `ChapterQueueSchema`, `StoryStateSchema`, `withProjectChapterOperationLease()`.
- Produces: `AuthorRevisionRecordSchema`, `ChapterDirectionSelectionSchema`, `AuthorEditInvalidationReportSchema`, and their inferred TypeScript types.
- Produces: `createAuthorRevision()`, `adoptAuthorRevision()`, `archiveInvalidatedChapterArtifacts()`, and `readLatestAdoptedDraft()`.

- [ ] **Step 1: Write schema fixtures that prove strict validation**

Create schema tests with this valid record shape:

```ts
const validRevision = {
  schemaVersion: '1.0',
  revisionId: 'author_revision_ch001_plan_v1',
  projectId: 'demo-novel',
  chapterNumber: 1,
  artifactKind: 'selected_plan',
  mode: 'direct_edit',
  sourceArtifactPath: 'chapters/chapter_001/selected_plan.md',
  sourceCandidateId: 'plan_001',
  sourceHash: 'a'.repeat(64),
  workingCopyPath: 'chapters/chapter_001/author_revisions/plan_revision_v1.md',
  workingCopyHash: 'b'.repeat(64),
  state: 'ready',
  authorInstruction: null,
  createdAt: '2026-08-04T01:00:00.000Z',
  adoptedAt: null,
  invalidationReportPath: null,
  storyStateMutated: false
};

expect(AuthorRevisionRecordSchema.parse(validRevision)).toEqual(validRevision);
expect(() => AuthorRevisionRecordSchema.parse({
  ...validRevision,
  storyStateMutated: true,
  leakedPath: '/home/author/project'
})).toThrow();
```

Cover all artifact kinds (`mission`, `selected_plan`, `draft`), modes, states, invalidated-node enum values, lowercase SHA-256 length, nullable timestamps, and strict unknown-key rejection.

- [ ] **Step 2: Run the schema test and verify missing exports fail**

Run:

```bash
corepack pnpm exec vitest run tests/unit/chapterAuthorRevisionSchemas.test.ts
```

Expected: FAIL because `src/schemas/chapterAuthorRevision.ts` and exports do not exist.

- [ ] **Step 3: Define strict schemas and inferred types**

Use these enums and required record fields:

```ts
export const AuthorRevisionArtifactKindSchema = z.enum([
  'mission',
  'selected_plan',
  'draft'
]);
export const AuthorRevisionModeSchema = z.enum([
  'direct_edit',
  'codex_adjustment'
]);
export const AuthorRevisionStateSchema = z.enum([
  'working',
  'ready',
  'adopted',
  'rejected',
  'superseded'
]);
export const AuthorInvalidatedNodeSchema = z.enum([
  'plan_candidates',
  'ranking',
  'selected_plan',
  'scene_cards',
  'scene_drafts',
  'draft',
  'future_diagnostics'
]);
```

`AuthorRevisionRecordSchema` must include nullable `sourceCandidateId`. Mission and draft revisions set it to null; plan revisions bind it to the trusted candidate on which the working copy or Codex adjustment is based.

`ChapterDirectionSelectionSchema` must include `selectionId`, `projectId`, `chapterNumber`, previous/selected internal candidate IDs, `modelRecommendedCandidateId`, `differsFromModelRecommendation`, `sourceReviewHash`, `selectedPlanHash`, `generatedAt`, nullable `invalidationReportPath`, and `storyStateMutated: z.literal(false)`. Later reads use `modelRecommendedCandidateId` to keep the original AI recommendation visible after the active ranking selection changes.

`AuthorEditInvalidationReportSchema` must include project/chapter scope, edited node, invalidated nodes, retained artifact references, archived artifact references with hash and byte size, queue before/after status and stage, reason, author-facing next step, timestamp, and `storyStateMutated: false`.

- [ ] **Step 4: Write failing storage and Story State protection tests**

Create a temporary project and assert:

```ts
const stateBefore = await sha256(paths.storyState());
const created = await createAuthorRevision({
  projectRoot: paths.projectRoot,
  chapterNumber: 1,
  artifactKind: 'selected_plan',
  mode: 'direct_edit',
  sourceArtifactPath: paths.chapterArtifact(1, 'selected_plan.md'),
  sourceCandidateId: 'plan_001',
  content: '# 新方向\n\n只改变章节计划。\n',
  authorInstruction: null
});

expect(created.record.state).toBe('ready');
expect(created.relativeMarkdownPath).toBe(
  'chapters/chapter_001/author_revisions/plan_revision_v1.md'
);
expect(await sha256(paths.storyState())).toBe(stateBefore);
```

Also create two revisions and assert version numbers increment without overwriting v1.

- [ ] **Step 5: Run the storage test and verify it fails**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/chapterAuthorRevisionSchemas.test.ts \
  tests/integration/chapterAuthorRevisionStore.test.ts
```

Expected: schema tests pass after Step 3; storage test fails because the service is absent.

- [ ] **Step 6: Implement bounded revision storage and archive copying**

Expose exact signatures:

```ts
export interface CreateAuthorRevisionInput {
  projectRoot: string;
  chapterNumber: number;
  artifactKind: AuthorRevisionArtifactKind;
  mode: AuthorRevisionMode;
  sourceArtifactPath: string;
  sourceCandidateId: string | null;
  content: string;
  authorInstruction: string | null;
}

export interface CreateAuthorRevisionResult {
  record: AuthorRevisionRecord;
  relativeRecordPath: string;
  relativeMarkdownPath: string;
}

export async function createAuthorRevision(
  input: CreateAuthorRevisionInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult>;
```

Rules:

1. Resolve and guard `projectRoot` with `FileStore.forProject()`.
2. Reject committed chapters (`chapterNumber <= latestCommittedChapter`).
3. Limit revision Markdown to 2 MiB and author instruction to 4,000 characters.
4. Allocate `vN` from validated existing record names, never from renderer input.
5. Hash source and working content with SHA-256.
6. Convert all paths stored in records to project-relative paths and reject any value that escapes the project root.
7. Write Markdown first, then schema-validated JSON; remove neither prior versions nor generated sources.
8. `archiveInvalidatedChapterArtifacts()` recursively copies only the bounded allowlist for the edited node into `author_revisions/archive/<revisionId>/` using `FileStore.readText()` and `FileStore.writeText()`; record missing optional files instead of failing.

- [ ] **Step 7: Run schema/storage tests and build**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/chapterAuthorRevisionSchemas.test.ts \
  tests/integration/chapterAuthorRevisionStore.test.ts
corepack pnpm build
```

Expected: PASS; v1 remains intact after v2; all JSON parses; Story State hash is unchanged.

- [ ] **Step 8: Commit the schema and storage primitive**

```bash
git add \
  src/schemas/chapterAuthorRevision.ts \
  src/schemas/index.ts \
  src/app/chapterAuthorRevision.ts \
  tests/unit/chapterAuthorRevisionSchemas.test.ts \
  tests/integration/chapterAuthorRevisionStore.test.ts
git commit -m "feat(chapter): add author revision records"
```

---

### Task 3: Direction selection and conservative invalidation

**Files:**
- Create: `src/desktop/chapterAuthoring.ts`
- Modify: `src/desktop/index.ts`
- Modify: `src/app/chapterAuthorRevision.ts`
- Test: `tests/integration/desktopChapterDirectionSelection.test.ts`
- Test: `tests/integration/chapterAuthorInvalidation.test.ts`

**Interfaces:**
- Consumes: revision schemas/storage from Task 2, `ChapterPlanRankingSchema`, `ChapterQueue`, project operation lease.
- Produces: `selectDesktopChapterDirection(input)`, `createDesktopChapterPlanRevision(input)`, and `adoptDesktopChapterPlanRevision(input)`.
- Produces queue transitions: candidate/plan adoption ends at `planned_ready/ranking`; scenes and draft are archived before the active plan changes.

- [ ] **Step 1: Write failing atomic selection tests**

Set up three candidate files, ranking selecting `plan_001`, scenes, and `draft_v1.md`. Assert:

```ts
const result = await selectDesktopChapterDirection({
  projectRoot: paths.projectRoot,
  chapterNumber: 1,
  candidateId: 'plan_002',
  expectedReviewHash
});

expect(result.selectedTitle).toBe('从交通事故切入');
expect((await fileStore.readJson(rankingPath, ChapterPlanRankingSchema))
  .selectedCandidateId).toBe('plan_002');
expect(await fileStore.readText(selectedPlanPath)).toContain('# 从交通事故切入');
expect(result.invalidatedNodes).toEqual([
  'selected_plan', 'scene_cards', 'scene_drafts', 'draft'
]);
expect(await sha256(paths.storyState())).toBe(stateBefore);
```

Read and validate `direction_selection_v1.json` and `edit_invalidation_report_v1.json`. Assert archived scene/draft copies still exist and source candidate files are unchanged.

- [ ] **Step 2: Run tests and verify selection API is absent**

Run:

```bash
corepack pnpm exec vitest run \
  tests/integration/desktopChapterDirectionSelection.test.ts \
  tests/integration/chapterAuthorInvalidation.test.ts
```

Expected: FAIL on missing `selectDesktopChapterDirection` export.

- [ ] **Step 3: Implement source freshness and atomic direction adoption**

Use this trusted engine input; `candidateId` never crosses to renderer:

```ts
export interface SelectDesktopChapterDirectionInput {
  projectRoot: string;
  chapterNumber: number;
  candidateId: string;
  expectedReviewHash: string;
}
```

Inside `withProjectChapterOperationLease({ operation: 'desktop-author-adoption', allowStoryStateWrite: false })`:

1. Re-read mission, all candidate Markdown, ranking, queue, and Story State.
2. Recompute the review hash and throw `DESKTOP_CHAPTER_EDIT_STALE` if it differs.
3. Reject an unknown candidate or a chapter at/below `latestCommittedChapter`.
4. Archive existing selected plan, scenes, and draft before replacement.
5. Write a new validated ranking object with `selectedCandidateId`, `selectedPlanPath`, and rationale `作者选择：<title>`.
6. Write selected Markdown atomically.
7. Set queue item to `planned_ready/ranking`, completed stages through `ranking`, and clear failure reason.
8. Write selection and invalidation JSON records with `storyStateMutated: false`; preserve the first model recommendation in `modelRecommendedCandidateId` across later author selections.

If any ranking, selected-plan, queue, selection-record, or invalidation-record write fails, restore ranking, selected plan, and queue from their already-read values and rethrow. The rollback writes are also `FileStore` writes; archive copies and failed-operation provenance may remain, but they are never treated as active.

- [ ] **Step 4: Add plan-revision adoption with the narrower dependency set**

Expose creation and adoption:

```ts
export async function createDesktopChapterPlanRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  candidateId: string;
  expectedReviewHash: string;
  markdown: string;
}): Promise<CreateAuthorRevisionResult>;

export async function adoptDesktopChapterPlanRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}): Promise<DesktopAuthorAdoptionResult>;
```

It must archive and invalidate only `scene_cards`, `scene_drafts`, and `draft`; preserve mission and plan candidates; atomically replace `selected_plan.md`; mark the revision adopted; supersede the previous adopted plan revision; and keep Story State byte-identical.

If the revision was created from a non-active direction, adoption must also set ranking `selectedCandidateId` to the revision record's trusted `sourceCandidateId`. Saving and comparing that revision do not change ranking; adoption is the first operation that changes the active direction.

- [ ] **Step 5: Run integration and lifecycle regressions**

Run:

```bash
corepack pnpm exec vitest run \
  tests/integration/desktopChapterDirectionSelection.test.ts \
  tests/integration/chapterAuthorInvalidation.test.ts \
  tests/integration/chapterDesktopLifecycle.test.ts \
  tests/e2e/chapterQueueLifecycle.test.ts
corepack pnpm build
```

Expected: PASS; stale hash and committed-chapter cases reject before writes; queue and Story State remain consistent.

- [ ] **Step 6: Commit direction selection and plan adoption**

```bash
git add \
  src/desktop/chapterAuthoring.ts \
  src/desktop/index.ts \
  src/app/chapterAuthorRevision.ts \
  tests/integration/desktopChapterDirectionSelection.test.ts \
  tests/integration/chapterAuthorInvalidation.test.ts
git commit -m "feat(desktop): add controlled chapter direction adoption"
```

---

### Task 4: Mission editing and participant-roster repair

**Files:**
- Modify: `src/schemas/chapterMission.ts`
- Modify: `src/app/chapterReferenceValidation.ts`
- Modify: `src/app/chapterPlanning.ts`
- Modify: `src/app/chapterDrafting.ts`
- Modify: `src/desktop/chapterAuthoring.ts`
- Modify: `src/desktop/chapterWorkspace.ts`
- Modify: `prompts/codex-text/planning/plan_chapter_mission_slim.md`
- Modify: `schemas/codex-output/slim/planning.chapter_mission.slim.schema.json`
- Modify: `src/providers/codex/normalizers.ts`
- Test: `tests/unit/chapterReferenceValidation.test.ts`
- Test: `tests/integration/chapterMissionCharacterReferences.test.ts`
- Test: `tests/integration/desktopChapterParticipantRepair.test.ts`
- Test: `tests/integration/desktopMissionAdoption.test.ts`

**Interfaces:**
- Consumes: revision storage/adoption from Tasks 2-3.
- Produces: backward-compatible `participatingCharacterIds: string[]` on `ChapterMissionSchema`.
- Produces: `missionParticipantSet()`, `assertMissionHasParticipants()`, `createDesktopMissionRevision()`, and `adoptDesktopMissionRevision()`.
- Produces engine error code: `CHAPTER_PARTICIPANT_ROSTER_MISSING` before any scene-card provider call.

- [ ] **Step 1: Write participant preflight tests with a provider spy**

Cover the failed-project shape: empty Story State characters, empty `charactersToIntroduce`, and empty `participatingCharacterIds`.

```ts
await expect(generateSceneCards(input, fileStore)).rejects.toMatchObject({
  code: 'CHAPTER_PARTICIPANT_ROSTER_MISSING'
});
expect(provider.complete).not.toHaveBeenCalled();
expect(await sha256(paths.storyState())).toBe(stateBefore);
```

Add passing cases for a committed participant and a provisional introduced participant. Add mission generation validation asserting an empty roster becomes invalid provider output when the project has no committed characters.

- [ ] **Step 2: Run focused tests and verify the empty roster reaches the provider**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/chapterReferenceValidation.test.ts \
  tests/integration/chapterMissionCharacterReferences.test.ts \
  tests/integration/desktopChapterParticipantRepair.test.ts
```

Expected: FAIL because scene generation currently calls the provider with empty `character_id_name_map`.

- [ ] **Step 3: Extend mission references without weakening scene validation**

Add the backward-compatible field:

```ts
participatingCharacterIds: z.array(
  z.string().trim().min(1).max(200)
).max(32).default([]),
```

Validate that each participating ID refers to either a committed Story State character or a mission provisional introduction and is unique. Keep `sceneCharacterReferencesAreValid()` unchanged in strictness.

Add:

```ts
export function missionParticipantSet(
  mission: ChapterMission,
  storyState: StoryState
): ReadonlySet<string> {
  return new Set([
    ...mission.participatingCharacterIds,
    ...mission.characterDeltas.map(({ characterId }) => characterId),
    ...mission.charactersToIntroduce.map(({ characterId }) => characterId)
  ].filter((id) => storyState.characters.some((item) => item.id === id)
    || mission.charactersToIntroduce.some((item) => item.characterId === id)));
}
```

Call the preflight immediately after reading mission/Story State and before creating/rendering the scene-card provider request.

- [ ] **Step 4: Harden mission generation output and retry guidance**

Add `participatingCharacterIds` to the slim schema and normalizer. Update the prompt with the explicit rule:

```text
When committed characters are empty, charactersToIntroduce must declare every named participant needed by this chapter. participatingCharacterIds must reference only committed or introduced character IDs. Never return an empty total participant roster for a chapter that will generate scenes.
```

After local Zod/reference validation, reject a zero-size participant set when Story State has no committed characters. Let the existing structured-output retry/repair policy handle only its configured attempts; do not add an unbounded retry.

- [ ] **Step 5: Write mission revision/adoption tests**

Use an author edit containing a new participant `{ name: '林默', role: '调查者' }`. Assert Electron/engine creates, rather than receives, this deterministic ID:

```ts
expect(revision.mission.charactersToIntroduce[0]).toMatchObject({
  characterId: expect.stringMatching(/^char_provisional_[a-f0-9]{16}$/),
  name: '林默',
  role: '调查者'
});
expect(revision.mission.participatingCharacterIds).toEqual([
  revision.mission.charactersToIntroduce[0]?.characterId
]);
```

Assert adoption archives the generated mission plus candidates/ranking/selected/scenes/draft, replaces `mission.json`, sets queue to `planning/mission`, and leaves Story State unchanged. The archived generated mission is the immutable `AI 原稿` used by comparison and provenance.

- [ ] **Step 6: Implement deterministic participant mapping and mission adoption**

Generate provisional IDs only in trusted engine code:

```ts
function provisionalCharacterId(
  projectId: string,
  chapterNumber: number,
  normalizedName: string
): string {
  return `char_provisional_${createHash('sha256')
    .update(`${projectId}\0${chapterNumber}\0${normalizedName}`)
    .digest('hex')
    .slice(0, 16)}`;
}
```

Reject duplicate normalized names and collisions with committed/provisional IDs. Preserve hidden objective/debt/character IDs through trusted source mapping. Mission adoption invalidates `plan_candidates`, `ranking`, `selected_plan`, `scene_cards`, `scene_drafts`, and `draft`, and never mutates Story State.

Expose the trusted engine facade as:

```ts
export interface DesktopMissionAuthorEdit {
  sourceMissionHash: string;
  chapterFunction: string;
  requiredObjectives: Array<{
    sourceObjectiveId: string | null;
    text: string;
    type: ChapterObjective['type'];
    priority: ChapterObjective['priority'];
  }>;
  debtsToPayOrAdvance: string[];
  debtsToIntroduce: ChapterMission['debtsToIntroduce'];
  characterDeltas: ChapterMission['characterDeltas'];
  participatingCharacterIds: string[];
  newCharacters: Array<{ name: string; role: string }>;
  readerInformationDelta: ChapterMission['readerInformationDelta'];
  forbiddenMoves: string[];
  targetEmotionalCurve: string[];
  targetWordCount: number | null;
}

export async function createDesktopMissionRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  edit: DesktopMissionAuthorEdit;
}): Promise<CreateAuthorRevisionResult>;

export async function adoptDesktopMissionRevision(input: {
  projectRoot: string;
  chapterNumber: number;
  revisionId: string;
  expectedSourceHash: string;
}): Promise<DesktopAuthorAdoptionResult>;
```

Electron main resolves opaque objective/debt/character tokens into the trusted IDs used by `DesktopMissionAuthorEdit`; the engine remains responsible for Zod validation, deterministic IDs for new objectives/characters, reference checks, durable revision records, adoption, and invalidation.

- [ ] **Step 7: Run participant, mission, drafting, and build regressions**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/chapterReferenceValidation.test.ts \
  tests/integration/chapterMissionCharacterReferences.test.ts \
  tests/integration/desktopChapterParticipantRepair.test.ts \
  tests/integration/desktopMissionAdoption.test.ts \
  tests/integration/chapterDraft.test.ts
corepack pnpm build
```

Expected: PASS; the empty-roster case performs zero provider calls; a repaired mission produces schema-valid scene character references.

- [ ] **Step 8: Commit mission editing and participant repair**

```bash
git add \
  src/schemas/chapterMission.ts \
  src/app/chapterReferenceValidation.ts \
  src/app/chapterPlanning.ts \
  src/app/chapterDrafting.ts \
  src/desktop/chapterAuthoring.ts \
  src/desktop/chapterWorkspace.ts \
  prompts/codex-text/planning/plan_chapter_mission_slim.md \
  schemas/codex-output/slim/planning.chapter_mission.slim.schema.json \
  src/providers/codex/normalizers.ts \
  tests/unit/chapterReferenceValidation.test.ts \
  tests/integration/chapterMissionCharacterReferences.test.ts \
  tests/integration/desktopChapterParticipantRepair.test.ts \
  tests/integration/desktopMissionAdoption.test.ts
git commit -m "feat(chapter): add mission participant repair"
```

---

### Task 5: Opaque Electron authoring API

**Files:**
- Modify: `apps/desktop/src/shared/chapterContract.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Create: `apps/desktop/src/main/chapter/ChapterReviewTokenStore.ts`
- Modify: `apps/desktop/src/main/chapter/EngineChapterGateway.ts`
- Modify: `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- Modify: `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/tests/main/chapterContract.test.ts`
- Test: `apps/desktop/tests/main/chapterHandlers.test.ts`
- Test: `apps/desktop/tests/main/projectChapterService.test.ts`
- Test: `apps/desktop/tests/main/chapterStateProtection.test.ts`

**Interfaces:**
- Consumes: trusted engine authoring facade from Tasks 3-4.
- Produces renderer methods `selectDirection`, `saveMissionWorkingCopy`, `savePlanWorkingCopy`, `adoptRevision`, and revised `readPlan`.
- Produces opaque token prefixes `chapter_review_`, `chapter_option_`, and `chapter_revision_`; tokens are random, project-bound, single-purpose, and expire after 30 minutes.

- [ ] **Step 1: Add strict contract tests before changing the API**

Define test payloads that contain no internal identifiers:

```ts
const request = ChapterSelectDirectionRequestSchema.parse({
  projectKey: 'project_radio',
  reviewToken: 'chapter_review_0123456789abcdef01234567',
  optionToken: 'chapter_option_0123456789abcdef01234567'
});
expect(() => ChapterSelectDirectionRequestSchema.parse({
  ...request,
  candidateId: 'plan_002'
})).toThrow();
```

Assert `ChapterPlanReviewResultSchema` exposes full Markdown and one option token for every direction, marks one `aiRecommended` and one `active`, and rejects paths/hashes/internal IDs.

- [ ] **Step 2: Run contract tests and verify the new methods are absent**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/chapterHandlers.test.ts
```

Expected: FAIL on missing request schemas/channels/service methods.

- [ ] **Step 3: Define bounded author-facing contract shapes**

Add these core schemas:

```ts
export const ChapterReviewTokenSchema = opaqueToken('chapter_review');
export const ChapterOptionTokenSchema = opaqueToken('chapter_option');
export const ChapterRevisionTokenSchema = opaqueToken('chapter_revision');

export const ChapterPlanDirectionSchema = z.object({
  optionToken: ChapterOptionTokenSchema,
  title: boundedText(240),
  markdown: markdownSchema(),
  excerpt: z.string().max(8_000),
  strengths: boundedTextArray(100, 2_000),
  risks: boundedTextArray(100, 2_000),
  aiRecommended: z.boolean(),
  active: z.boolean()
}).strict();
```

Add structured mission editor fields with opaque item/participant tokens, bounded text, and no raw IDs. Add strict requests:

```ts
type ChapterSelectDirectionRequest = {
  projectKey: string;
  reviewToken: string;
  optionToken: string;
};
type ChapterSavePlanWorkingCopyRequest = {
  projectKey: string;
  reviewToken: string;
  optionToken: string;
  markdown: string;
};
type ChapterAdoptRevisionRequest = {
  projectKey: string;
  revisionToken: string;
  confirmInvalidation: true;
};
```

Responses must use discriminated `outcome` values `saved`, `adopted`, `stale`, `blocked`, and `invalid`, with Chinese-safe message keys rather than engine error text.

- [ ] **Step 4: Implement project-bound token storage**

Create:

```ts
interface StoredReviewToken {
  projectKey: string;
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  reviewHash: string;
  optionBindings: ReadonlyMap<string, string>;
  createdAtMs: number;
}
```

`ChapterReviewTokenStore` must:

- create 192-bit random review/option/revision tokens;
- bind tokens to project, chapter, purpose, and source hash;
- reject cross-project use;
- expire tokens after 30 minutes;
- consume adoption tokens once;
- retain at most 200 review bindings and 500 revision bindings;
- return a fresh author-facing `stale` result instead of leaking token internals.

- [ ] **Step 5: Extend gateway/service and enforce one active operation**

`EngineChapterGateway.readPlan()` returns trusted engine data including internal candidate bindings to main only. `ProjectChapterService.readPlan()` converts these bindings into opaque tokens and schema-parses the public result. `savePlanWorkingCopy` resolves `optionToken` to its internal candidate and source hash, so any alternative can be edited without becoming active first.

Before save/select/adopt, `ProjectChapterService` checks `activeByProject` and `startingByProject`; a generation/adjustment task returns `generation_busy`. Resolve project root only from `projectKey`. Map engine errors as follows:

```ts
DESKTOP_CHAPTER_EDIT_STALE -> stale_edit
CHAPTER_PARTICIPANT_ROSTER_MISSING -> participant_roster_missing
DESKTOP_CHAPTER_INVALID_OUTPUT -> invalid_output
PROJECT_OPERATION_BUSY -> generation_busy
```

- [ ] **Step 6: Register fixed handlers and preload methods**

Add only these channels in this task:

```ts
chapterSelectDirection: 'novel-loop:chapter:select-direction'
chapterSaveMissionWorkingCopy: 'novel-loop:chapter:save-mission-working-copy'
chapterSavePlanWorkingCopy: 'novel-loop:chapter:save-plan-working-copy'
chapterAdoptRevision: 'novel-loop:chapter:adopt-revision'
```

Each handler must call `assertTrustedSender()`, parse the strict request, call one service method, parse the strict response, and return it. Preload exposes named wrappers only.

- [ ] **Step 7: Verify hostile input, cross-project tokens, and state protection**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/chapterContract.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterStateProtection.test.ts
corepack pnpm --dir apps/desktop check
```

Expected: PASS; hostile extra fields reject before service calls; cross-project token rejects; renderer responses contain no `/home/`, `plan_`, SHA-256, run ID, or schema name; Story State hash is unchanged.

- [ ] **Step 8: Commit the narrow Electron boundary**

```bash
git add \
  apps/desktop/src/shared/chapterContract.ts \
  apps/desktop/src/shared/desktopApi.ts \
  apps/desktop/src/shared/ipcChannels.ts \
  apps/desktop/src/main/chapter/ChapterReviewTokenStore.ts \
  apps/desktop/src/main/chapter/EngineChapterGateway.ts \
  apps/desktop/src/main/chapter/ProjectChapterService.ts \
  apps/desktop/src/main/ipc/registerChapterHandlers.ts \
  apps/desktop/src/preload/index.ts \
  apps/desktop/src/main/index.ts \
  apps/desktop/tests/main/chapterContract.test.ts \
  apps/desktop/tests/main/chapterHandlers.test.ts \
  apps/desktop/tests/main/projectChapterService.test.ts \
  apps/desktop/tests/main/chapterStateProtection.test.ts
git commit -m "feat(desktop): expose safe chapter authoring API"
```

---

### Task 6: Author-controlled direction and mission/plan UI

**Files:**
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterDirectionChooser.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chapter/ChapterDraftGenerationView.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/chapter.css`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`
- Modify: `apps/desktop/tests/renderer/desktopApiFixtures.ts`
- Test: `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`
- Test: `apps/desktop/tests/renderer/chapterParticipantRepair.test.tsx`

**Interfaces:**
- Consumes: Task 5 desktop API and public contracts.
- Produces: direct edit/save/compare/adopt UI; every direction can be expanded and selected; participant repair returns to mission editor.
- Produces no filesystem, provider, queue, or Story State access in renderer.

- [ ] **Step 1: Write renderer behavior tests**

Add tests for:

```ts
expect(screen.queryByText('Untitled Plan')).not.toBeInTheDocument();
expect(screen.getAllByRole('button', { name: '设为本章方向' })).toHaveLength(2);

fireEvent.click(screen.getAllByRole('button', {
  name: '设为本章方向'
})[0]!);
expect(api.chapter.selectDirection).toHaveBeenCalledWith({
  projectKey,
  reviewToken: completeChapterPlan.reviewToken,
  optionToken: completeChapterPlan.directions[1]!.optionToken
});
```

Test `编辑本章任务`, add participant name/role, `保存草稿`, invalidation confirmation, `采用此版`, stale response copy, keyboard focus restoration, and `aria-live` save status.

Add participant failure routing:

```ts
expect(screen.getByText('本章还没有声明可参与场景的人物。请确认人物后再生成初稿。')).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: '补充本章人物' }));
expect(screen.getByRole('heading', { name: '编辑本章任务' })).toBeVisible();
```

- [ ] **Step 2: Run renderer tests and verify controls are missing**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx
```

Expected: FAIL because alternatives remain read-only and participant failure is generic.

- [ ] **Step 3: Build the direction chooser as peer options**

Render every direction with:

- title and full Markdown-safe text;
- `AI 推荐` and `当前方向` text labels;
- strengths and risks;
- `设为本章方向`, `编辑后使用`, and a Task 7-disabled `让 AI 调整此方向` control with explanatory tooltip until Task 7 lands.

Do not use nested cards. Use one bordered list with stable headings, radio semantics (`role="radiogroup"`/`role="radio"`), and a separate confirmation area that lists `场景规划、场景草稿、章节初稿` when direction adoption invalidates them.

- [ ] **Step 4: Build structured mission and Markdown plan editing**

Mission editor controls:

- textarea for chapter purpose;
- repeatable text rows for objectives, promises, character changes, reader knowledge/questions, and forbidden moves;
- participant rows with name and role;
- `保存草稿`, `放弃修改`, `对比修改`, `采用此版`.

Plan editor controls, opened from the chosen direction's `optionToken`:

- Markdown textarea;
- read-only preview tab;
- Chinese word count;
- browser-native undo/redo keyboard behavior;
- explicit `未保存` / `已保存，等待采用` / `已采用` states.

Saving produces a pending revision but does not change the active direction. If the source option was an alternative, adoption both selects that base direction and activates the edited Markdown. Adoption always follows a second confirmation showing invalidated nodes.

- [ ] **Step 5: Add natural recovery states and accessible focus**

Map public error kinds to copy:

```ts
stale_edit: '内容已变化，请重新对比后采用。你的编辑草稿仍然保留。'
participant_roster_missing: '本章还没有声明可参与场景的人物。请确认人物后再生成初稿。'
invalid_output: 'AI 返回的内容暂时无法使用，请调整意见后重试。'
generation_busy: '当前已有任务正在运行，请等待完成或先取消任务。'
```

Use an accessible live region for save/adopt status. Cancelled confirmations restore focus to their trigger. Selection must not rely on green color alone.

- [ ] **Step 6: Run renderer, type, and existing workflow tests**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/renderer/chapterPlanReview.test.tsx \
  tests/renderer/chapterParticipantRepair.test.tsx \
  tests/renderer/chapterDraftGeneration.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
corepack pnpm --dir apps/desktop check
```

Expected: PASS; all controls and state labels are Chinese; no internal identifiers render.

- [ ] **Step 7: Commit the direct authoring UI**

```bash
git add \
  apps/desktop/src/renderer/src/features/chapter/ChapterDirectionChooser.tsx \
  apps/desktop/src/renderer/src/features/chapter/ChapterMissionEditor.tsx \
  apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx \
  apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx \
  apps/desktop/src/renderer/src/features/chapter/ChapterDraftGenerationView.tsx \
  apps/desktop/src/renderer/src/styles/chapter.css \
  apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts \
  apps/desktop/tests/renderer/desktopApiFixtures.ts \
  apps/desktop/tests/renderer/chapterPlanReview.test.tsx \
  apps/desktop/tests/renderer/chapterParticipantRepair.test.tsx
git commit -m "feat(desktop): add author-controlled chapter planning"
```

---

### Task 7: Bounded Codex mission and plan adjustments

**Files:**
- Create: `src/app/chapterAuthorAdjustment.ts`
- Create: `prompts/codex-text/planning/adjust_chapter_mission_slim.md`
- Create: `prompts/codex-text/planning/adjust_plan_candidate_slim.md`
- Create: `schemas/codex-output/slim/planning.chapter_mission_adjustment.slim.schema.json`
- Create: `schemas/codex-output/slim/planning.plan_adjustment.slim.schema.json`
- Modify: `src/providers/codex/schemas.ts`
- Modify: `src/providers/codex/normalizers.ts`
- Modify: `src/desktop/chapterAuthoring.ts`
- Modify: `src/desktop/index.ts`
- Modify: `apps/desktop/src/shared/chapterContract.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/main/chapter/EngineChapterGateway.ts`
- Modify: `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- Modify: `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx`
- Test: `tests/integration/chapterAuthorAdjustment.test.ts`
- Test: `tests/providers/codexSchemas.test.ts`
- Test: `apps/desktop/tests/main/projectChapterService.test.ts`
- Test: `apps/desktop/tests/renderer/chapterPlanReview.test.tsx`

**Interfaces:**
- Consumes: `ProviderFactory.create({ provider: 'codex-text', ... })`, prompt service, Task 2 revision store, Task 5 token store.
- Produces app services `adjustChapterMission()` / `adjustChapterPlan()` and desktop facade wrappers `adjustDesktopChapterMission()` / `adjustDesktopChapterPlan()`, all returning ready, unadopted revisions.
- Produces desktop methods `adjustMission(request)` and `adjustPlan(request)` with bounded author instruction.

- [ ] **Step 1: Write fake-Codex adjustment tests**

Use deterministic provider output and assert:

```ts
const result = await adjustDesktopChapterPlan({
  projectRoot: paths.projectRoot,
  chapterNumber: 1,
  expectedSourceHash,
  authorInstruction: '把开场提前到事故现场，但不要新增人物。'
});

expect(result.record.mode).toBe('codex_adjustment');
expect(result.record.state).toBe('ready');
expect(await fileStore.readText(selectedPlanPath)).toBe(selectedBefore);
expect(await sha256(paths.storyState())).toBe(stateBefore);
```

Add invalid JSON/schema output, timeout, stale source, cancel-before-provider, and instruction-over-4,000-character cases. Assert no candidate is adopted automatically.

Add a desktop recovery assertion that `AI 补全本章人物` calls mission adjustment with the fixed bounded instruction `补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。`, returns a pending comparison, and still requires explicit adoption.

Add a desktop recovery assertion that `AI 补全本章人物` calls mission adjustment with the fixed bounded instruction `补全本章场景所需人物，只声明已有或本章首次出场人物，不新增剧情事实。`, returns a pending comparison, and still requires explicit adoption.

- [ ] **Step 2: Run focused tests and verify prompts/descriptors are missing**

Run:

```bash
corepack pnpm exec vitest run \
  tests/integration/chapterAuthorAdjustment.test.ts \
  tests/providers/codexSchemas.test.ts
```

Expected: FAIL because adjustment prompt IDs and services are absent.

- [ ] **Step 3: Define schema-constrained adjustment outputs**

Mission output is a complete `ChapterMission`-compatible value after normalization. Plan output is:

```json
{
  "type": "object",
  "required": ["title", "markdown", "changeSummary", "preservedConstraints"],
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 240 },
    "markdown": { "type": "string", "minLength": 1, "maxLength": 2097152 },
    "changeSummary": { "type": "array", "items": { "type": "string" }, "maxItems": 20 },
    "preservedConstraints": { "type": "array", "items": { "type": "string" }, "maxItems": 50 }
  },
  "additionalProperties": false
}
```

Register descriptors and local Zod normalization. The prompts explicitly forbid Story State changes, new unrequested characters/facts, shell commands, workspace writes, and whole-project rewrites.

- [ ] **Step 4: Implement read-only adjustment services**

Expose:

```ts
export async function adjustChapterMission(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult>;

export async function adjustChapterPlan(
  input: ChapterAuthorAdjustmentInput,
  fileStore?: FileStore
): Promise<CreateAuthorRevisionResult>;
```

The input includes project root, chapter number, expected source hash, bounded instruction, optional cancellation check, and provider options fixed to `codex-text`. Supply only current artifact, bounded mission context, selected-plan context where applicable, and summarized relevant Story State. Use one provider call plus only the provider's configured JSON retry/repair policy. Store raw provider provenance using existing Codex facilities; return only the revision candidate to desktop main.

For plan adjustment, main resolves the request's `optionToken`; the service receives the trusted source candidate ID/content. This allows `让 AI 调整此方向` on any alternative without changing active ranking before explicit adoption.

`src/desktop/chapterAuthoring.ts` exports `adjustDesktopChapterMission()` and `adjustDesktopChapterPlan()` as narrow wrappers. They resolve desktop project context, acquire no write permission beyond the app service's `allowStoryStateWrite: false` lease, and return trusted revision metadata to Electron main; only main converts the revision ID into an opaque token.

- [ ] **Step 5: Extend task lifecycle and renderer API**

Add task kinds `mission_adjustment` and `plan_adjustment`, and stages `requesting_adjustment`, `validating_adjustment`, and `ready_for_review`. A successful task returns an opaque `resultRevisionToken`; cancellation is allowed before provider spawn and between validation/storage stages.

Define `ChapterAdjustMissionRequest` as `{ projectKey, reviewToken, authorInstruction }` and `ChapterAdjustPlanRequest` as `{ projectKey, reviewToken, optionToken, authorInstruction }`. Both are strict, cap the instruction at 4,000 characters, and reject renderer-supplied provider/profile/path fields.

Add fixed IPC methods `chapterAdjustMission` and `chapterAdjustPlan`. Reject provider/profile/path fields from renderer requests. Render an inline instruction panel with scope copy, progress, cancel, compare, `采用此版`, and `保留当前版`.

- [ ] **Step 6: Verify Codex safety and desktop regressions**

Run:

```bash
corepack pnpm exec vitest run \
  tests/integration/chapterAuthorAdjustment.test.ts \
  tests/providers/codexSchemas.test.ts \
  tests/e2e/codexSingleChapterSmoke.test.ts
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/projectChapterService.test.ts \
  tests/main/chapterHandlers.test.ts \
  tests/renderer/chapterPlanReview.test.tsx
corepack pnpm build
corepack pnpm --dir apps/desktop check
```

Expected: PASS; fake Codex remains deterministic; adjustment records are ready but unadopted; Story State is byte-identical.

- [ ] **Step 7: Commit bounded Codex adjustments**

```bash
git add \
  src/app/chapterAuthorAdjustment.ts \
  prompts/codex-text/planning/adjust_chapter_mission_slim.md \
  prompts/codex-text/planning/adjust_plan_candidate_slim.md \
  schemas/codex-output/slim/planning.chapter_mission_adjustment.slim.schema.json \
  schemas/codex-output/slim/planning.plan_adjustment.slim.schema.json \
  src/providers/codex/schemas.ts \
  src/providers/codex/normalizers.ts \
  src/desktop/chapterAuthoring.ts \
  src/desktop/index.ts \
  apps/desktop/src/shared/chapterContract.ts \
  apps/desktop/src/shared/desktopApi.ts \
  apps/desktop/src/shared/ipcChannels.ts \
  apps/desktop/src/main/chapter/EngineChapterGateway.ts \
  apps/desktop/src/main/chapter/ProjectChapterService.ts \
  apps/desktop/src/main/ipc/registerChapterHandlers.ts \
  apps/desktop/src/preload/index.ts \
  apps/desktop/src/renderer/src/features/chapter/ChapterPlanReview.tsx \
  apps/desktop/src/renderer/src/features/chapter/ChapterRevisionCompare.tsx \
  tests/integration/chapterAuthorAdjustment.test.ts \
  tests/providers/codexSchemas.test.ts \
  apps/desktop/tests/main/projectChapterService.test.ts \
  apps/desktop/tests/renderer/chapterPlanReview.test.tsx
git commit -m "feat(desktop): add bounded Codex chapter adjustments"
```

---

### Task 8: Draft editor, autosave, recovery, and adoption

**Files:**
- Create: `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts`
- Create: `apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx`
- Modify: `src/app/chapterAuthorRevision.ts`
- Modify: `src/desktop/chapterAuthoring.ts`
- Modify: `src/desktop/chapterWorkspace.ts`
- Modify: `src/desktop/index.ts`
- Modify: `apps/desktop/src/shared/chapterContract.ts`
- Modify: `apps/desktop/src/shared/desktopApi.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/main/chapter/EngineChapterGateway.ts`
- Modify: `apps/desktop/src/main/chapter/ProjectChapterService.ts`
- Modify: `apps/desktop/src/main/ipc/registerChapterHandlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/chapter.css`
- Test: `tests/integration/desktopDraftAdoption.test.ts`
- Test: `apps/desktop/tests/main/draftWorkingCopyStore.test.ts`
- Test: `apps/desktop/tests/renderer/chapterDraftEditor.test.tsx`

**Interfaces:**
- Consumes: Task 2 revision store and Task 5 opaque tokens.
- Produces: `readDraftWorkingCopy`, `saveDraftWorkingCopy`, `discardDraftWorkingCopy`, `adoptDraftRevision`.
- Produces autosave location `<Electron userData>/working-copies/<projectKey>/chapter_XXX/draft.json`; renderer never receives this path.

- [ ] **Step 1: Write atomic autosave and crash-recovery tests**

Use a temporary user-data root:

```ts
await store.save({
  projectKey,
  chapterNumber: 1,
  sourceHash: 'a'.repeat(64),
  markdown: '# 第一章\n\n作者修改后的段落。\n',
  savedAt: '2026-08-04T01:00:00.000Z'
});

const reopened = new DraftWorkingCopyStore(root);
expect(await reopened.read(projectKey, 1)).toMatchObject({
  markdown: expect.stringContaining('作者修改后的段落'),
  recoveryAvailable: true
});
```

Test corrupted working-copy JSON is quarantined and reported unavailable, source-hash mismatch returns stale recovery, size over 2 MiB rejects, and failed atomic replacement preserves the prior working copy.

- [ ] **Step 2: Write renderer debounce/recovery tests**

Use fake timers and assert:

```ts
fireEvent.change(screen.getByRole('textbox', { name: '章节正文' }), {
  target: { value: '# 第一章\n\n新的正文。' }
});
expect(screen.getByText('尚未保存')).toBeVisible();
await vi.advanceTimersByTimeAsync(750);
expect(api.chapter.saveDraftWorkingCopy).toHaveBeenCalledTimes(1);
expect(screen.getByRole('status')).toHaveTextContent('已自动保存');
```

On reload, show `已恢复上次未采用的编辑草稿` and require `继续编辑` or `放弃恢复`.

- [ ] **Step 3: Run tests and verify working-copy methods are absent**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/draftWorkingCopyStore.test.ts \
  tests/renderer/chapterDraftEditor.test.tsx
corepack pnpm exec vitest run tests/integration/desktopDraftAdoption.test.ts
```

Expected: FAIL on missing store/API/editor.

- [ ] **Step 4: Implement user-data working-copy storage**

Define `DraftWorkingCopyRecordSchema` before writing a strict main-only record with project key, chapter number, source hash, Markdown, and timestamp. Do not persist the review token: after restart, the service re-reads the active draft, compares its source hash, and issues a fresh token for adoption. Parse both reads and writes through this Zod schema. Use a local temp file plus rename in `DraftWorkingCopyStore`; do not use project paths or engine `FileStore` for Electron user-data. File mode is `0o600`; directory mode is `0o700`. Never include project root, Codex output, auth, or token values in logs.

Expose strict public responses containing only content, save state, and opaque revision token. Add fixed channels:

```ts
chapterReadDraftWorkingCopy
chapterSaveDraftWorkingCopy
chapterDiscardDraftWorkingCopy
chapterAdoptDraftRevision
```

- [ ] **Step 5: Implement draft revision adoption without overwriting generated source**

On explicit adoption:

1. Validate source hash and uncommitted chapter.
2. Promote working Markdown to `author_revisions/draft_revision_vN.md` and write its schema record.
3. Mark it adopted and supersede the older adopted draft revision.
4. Keep generated `draft_v1.md` byte-identical.
5. Make `readDesktopChapterDraft()` resolve the newest adopted draft revision first and return `versionKind: 'author_adopted'`; otherwise return generated `draft_v1.md` with `versionKind: 'generated'`.
6. Clear the user-data working copy after successful adoption only.
7. Record future diagnostics invalidation without creating diagnostics artifacts.
8. Keep queue at `draft_ready/draft_assembly` and Story State unchanged.

- [ ] **Step 6: Build the manuscript editor**

Use a full-width writing surface with `编辑` and `预览` tabs, stable word count, generated/adopted version label, 750 ms autosave, explicit save status, discard confirmation, comparison, and explicit adoption. Do not use contenteditable or rich-text conversion in Phase A.

Keyboard behavior:

- `Ctrl+S` requests immediate working-copy save and prevents browser behavior;
- `Ctrl+Shift+P` toggles preview;
- `Escape` closes comparison/confirmation and restores focus;
- native textarea undo/redo remains available.

- [ ] **Step 7: Run draft, desktop, and state-protection tests**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run \
  tests/main/draftWorkingCopyStore.test.ts \
  tests/main/chapterStateProtection.test.ts \
  tests/renderer/chapterDraftEditor.test.tsx \
  tests/renderer/chapterWorkspace.test.tsx
corepack pnpm exec vitest run \
  tests/integration/desktopDraftAdoption.test.ts \
  tests/integration/chapterDraft.test.ts
corepack pnpm build
corepack pnpm --dir apps/desktop check
```

Expected: PASS; generated draft remains intact; adopted draft resolves as active; autosave survives service recreation; Story State hash is unchanged.

- [ ] **Step 8: Commit draft editing and recovery**

```bash
git add \
  apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts \
  apps/desktop/src/renderer/src/features/chapter/ChapterDraftEditor.tsx \
  src/app/chapterAuthorRevision.ts \
  src/desktop/chapterAuthoring.ts \
  src/desktop/chapterWorkspace.ts \
  src/desktop/index.ts \
  apps/desktop/src/shared/chapterContract.ts \
  apps/desktop/src/shared/desktopApi.ts \
  apps/desktop/src/shared/ipcChannels.ts \
  apps/desktop/src/main/chapter/EngineChapterGateway.ts \
  apps/desktop/src/main/chapter/ProjectChapterService.ts \
  apps/desktop/src/main/ipc/registerChapterHandlers.ts \
  apps/desktop/src/preload/index.ts \
  apps/desktop/src/main/index.ts \
  apps/desktop/src/renderer/src/features/chapter/ChapterWorkspace.tsx \
  apps/desktop/src/renderer/src/styles/chapter.css \
  tests/integration/desktopDraftAdoption.test.ts \
  apps/desktop/tests/main/draftWorkingCopyStore.test.ts \
  apps/desktop/tests/renderer/chapterDraftEditor.test.tsx \
  apps/desktop/tests/renderer/chapterWorkspace.test.tsx
git commit -m "feat(desktop): add recoverable chapter draft editing"
```

---

### Task 9: Electron end-to-end acceptance and operator documentation

**Files:**
- Modify: `apps/desktop/tests/e2e/electron-smoke.test.ts`
- Modify: `apps/desktop/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts`

**Interfaces:**
- Consumes: all Phase A engine/Electron/renderer interfaces.
- Produces: one reproducible fake-Codex Electron acceptance flow and current author/operator instructions.
- Produces verification evidence that Story State and `latestCommittedChapter` never change during desktop planning/editing/drafting.

- [ ] **Step 1: Extend the fake-Codex Electron fixture**

Make candidate output contain three Chinese titles and a mission with a legal provisional participant. Add deterministic adjustment responses for mission and plan. Record each prompt ID so the test can assert no extra scene-card call occurs during participant repair.

- [ ] **Step 2: Write the complete acceptance flow before implementation verification**

Add one serial Electron test with this sequence:

```text
open project
-> review three titled directions
-> select the second, non-recommended direction
-> edit and adopt the selected plan
-> inspect the downstream invalidation warning
-> remove participants from an unadopted mission working copy
-> verify drafting is blocked before the scene provider
-> add and adopt a provisional participant
-> generate the draft
-> edit and wait for autosave
-> close Electron
-> reopen Electron with the same userData
-> recover the working copy
-> adopt the edited draft
-> verify Story State hash and latestCommittedChapter are unchanged
```

Also assert `draft_v1.md` still has its original hash and a versioned adopted draft exists below `author_revisions/`.

- [ ] **Step 3: Run the Electron test and fix only acceptance defects**

Run:

```bash
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop exec playwright test \
  tests/e2e/electron-smoke.test.ts \
  --grep "author-controlled chapter"
```

Expected: PASS on hosts with a secure Electron sandbox. If the host lacks the required sandbox, the test remains skipped in ordinary local verification and fails under `NOVEL_LOOP_REQUIRE_ELECTRON_SMOKE=1`; never add `--no-sandbox`.

- [ ] **Step 4: Update author and operator documentation**

Document:

- the four author-visible revision states;
- selection, direct edit, AI adjustment, comparison, and explicit adoption;
- participant repair and why the engine does not weaken character validation;
- draft autosave location class (`Electron application data`, without a user-specific path);
- generated draft versus adopted author draft;
- Story State protection and Phase A stop point;
- `corepack pnpm desktop:dev`, the Linux watcher-limit remedy already documented for Ubuntu, and secure Electron sandbox requirements;
- unsupported scope from Global Constraints.

Remove README statements that say mission/plan/draft editing is unavailable. Add the desktop author-control capability under the existing `Unreleased` changelog section. Do not claim Story Foundation or global planning editing until Phase B is accepted.

- [ ] **Step 5: Run complete release-quality verification**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm check
corepack pnpm check:diff
corepack pnpm test
corepack pnpm --dir apps/desktop check
corepack pnpm --dir apps/desktop test
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop test:e2e
```

Expected: all required build/type/unit/integration suites pass; Electron smoke passes or reports only the pre-existing secure-sandbox skip condition; no test calls real Codex.

- [ ] **Step 6: Inspect the final diff and generated-file hygiene**

Run:

```bash
git status --short
git diff --check
git diff --name-only
git ls-files | rg '(^projects/|events\.ndjson$|codex/.*/raw|\.env$|token|auth)' || true
```

Expected: no project data, raw Codex artifact, secret, token, auth file, `.playwright-mcp/`, or screenshot is staged.

- [ ] **Step 7: Commit acceptance tests and documentation**

```bash
git add \
  apps/desktop/tests/e2e/electron-smoke.test.ts \
  apps/desktop/README.md \
  README.md \
  CHANGELOG.md \
  apps/desktop/src/renderer/src/i18n/messages.zh-CN.ts
git commit -m "test(desktop): verify author-controlled chapter flow"
```

---

## Final Acceptance Checklist

- [ ] Chinese UI contains no `Untitled Plan` fallback.
- [ ] Every direction is readable, keyboard reachable, selectable, editable, and eligible for bounded AI adjustment.
- [ ] Mission and plan working copies do not alter active artifacts until adoption.
- [ ] Adoption archives invalidated uncommitted content and reports consequences in author language.
- [ ] Empty participant roster blocks before scene-card provider invocation.
- [ ] A direct provisional-character repair produces valid scene-card references.
- [ ] Draft editing autosaves after 750 ms, survives Electron restart, and requires explicit adoption.
- [ ] Generated `draft_v1.md` remains immutable; adopted draft is versioned under `author_revisions/`.
- [ ] Renderer receives no path, raw ID, hash, schema name, run ID, auth data, or raw Codex output.
- [ ] Story State file hash and `latestCommittedChapter` remain unchanged through the full Phase A desktop flow.
- [ ] Mock three-chapter, fake-Codex single-chapter, chapter lifecycle, conflict recovery, and existing review/recommit tests remain green.
- [ ] Phase B Story Foundation/global planning editing remains outside this implementation plan.
