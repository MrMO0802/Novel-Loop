# 技术架构与模块规格：Novel Loop Engine

## 1. 架构总览

```text
CLI
 │
 ▼
Command Handlers
 │
 ▼
Application Services / Orchestrators
 │
 ├── Strategy Service
 ├── Planning Service
 ├── Production Service
 ├── Diagnostics Service
 ├── Revision Service
 ├── Memory / State Service
 ├── Prompt Service
 └── Run Logger
 │
 ▼
Infrastructure
 ├── FileStore
 ├── LLMClient
 ├── Schema Validator
 └── Artifact Writer
```

核心思想：

- CLI 只做参数解析和调用 service。
- Orchestrator 控制 loop，不直接拼 prompt。
- PromptService 负责加载 prompt 模板和渲染输入。
- LLMClient 负责 provider 抽象。
- FileStore 负责所有读写。
- SchemaValidator 负责所有 JSON 验证。
- StateService 负责 Story State 的读取、更新、snapshot、rollback。

## 2. 推荐目录结构

```text
novel-loop-engine/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  README.md

  prompts/
    strategy/
      build_story_bible.md
      build_genre_contract.md
      build_reader_promise.md
    planning/
      plan_global_outline.md
      plan_chapter_mission.md
      generate_plan_candidates.md
      rank_plan_candidates.md
      generate_scene_cards.md
    production/
      write_scene.md
      assemble_chapter.md
    diagnostics/
      diagnose_chapter.md
      check_character_knowledge.md
      check_narrative_debt.md
    revision/
      create_revision_plan.md
      revise_draft.md
    memory/
      extract_canon_patch.md
      update_reader_state.md

  src/
    cli/
      index.ts
      commands/
        init.ts
        buildBible.ts
        planGlobal.ts
        chapter.ts
        validate.ts
        inspect.ts
        rollback.ts
        commitChapter.ts

    app/
      initProject.ts
      buildBible.ts
      planGlobal.ts
      runChapterLoop.ts
      validateProject.ts
      inspectProject.ts
      rollbackProject.ts
      commitChapter.ts

    engine/
      strategy/
      planning/
      production/
      diagnostics/
      revision/
      memory/

    schemas/
      config.ts
      storyState.ts
      characterState.ts
      narrativeDebt.ts
      foreshadowing.ts
      readerState.ts
      chapterMission.ts
      sceneCard.ts
      diagnostics.ts
      revisionPlan.ts
      canonPatch.ts
      runManifest.ts

    llm/
      LLMClient.ts
      MockLLMClient.ts
      ProviderFactory.ts
      JsonResponseParser.ts

    prompts/
      PromptService.ts
      TemplateRenderer.ts

    storage/
      FileStore.ts
      AtomicWriter.ts
      ProjectPaths.ts
      SnapshotStore.ts

    logging/
      RunLogger.ts
      errors.ts

    utils/
      ids.ts
      dates.ts
      result.ts
      text.ts

  tests/
    fixtures/
      projects/
      llm/
    unit/
    integration/
```

## 3. 核心领域对象

### 3.1 Project

一个小说项目。由 `projectId` 唯一标识。

### 3.2 Story State

小说当前 canon 状态集合，不等于正文。包含 canon facts、人物、时间线、读者状态、叙事债务等。

### 3.3 Chapter Artifacts

每章生产过程中产生的所有文件。

### 3.4 Run

一次 CLI 命令执行。一个 run 可以生成多个 artifacts。必须记录 manifest。

## 4. Chapter Loop 状态机

```text
NEW
 │
 ▼
MISSION_CREATED
 │
 ▼
PLANS_GENERATED
 │
 ▼
PLAN_SELECTED
 │
 ▼
SCENES_PLANNED
 │
 ▼
DRAFTED
 │
 ▼
DIAGNOSED ── hard failures / low score ──► REVISION_PLANNED
 │                                             │
 │                                             ▼
 │                                           REVISED
 │                                             │
 └──────────── pass quality gate ◄─────────────┘
 │
 ▼
FINALIZED
 │
 ▼
CANON_PATCHED
 │
 ▼
COMMITTED
```

Human review branch：

```text
DIAGNOSED / REVISED
  └── max attempts reached or unrecoverable issue
      └── HUMAN_REVIEW_REQUIRED
```

## 5. 核心接口设计

### 5.1 Orchestrator

```ts
export interface RunChapterLoopInput {
  projectId: string;
  chapterNumber: number | 'next';
  candidates?: number;
  maxRevisions?: number;
  provider?: string;
  dryRun?: boolean;
}

export interface RunChapterLoopResult {
  projectId: string;
  chapterNumber: number;
  status: 'committed' | 'human_review_required' | 'failed' | 'dry_run_complete';
  finalPath?: string;
  diagnosticsPath?: string;
  canonPatchPath?: string;
  runId: string;
}
```

### 5.2 Planning Service

```ts
export interface PlanningService {
  planChapterMission(input: PlanChapterMissionInput): Promise<ChapterMission>;
  generatePlanCandidates(input: GeneratePlanCandidatesInput): Promise<PlanCandidate[]>;
  rankPlanCandidates(input: RankPlanCandidatesInput): Promise<PlanRanking>;
  generateSceneCards(input: GenerateSceneCardsInput): Promise<SceneCard[]>;
}
```

### 5.3 Production Service

```ts
export interface ProductionService {
  writeScene(input: WriteSceneInput): Promise<SceneDraft>;
  assembleChapter(input: AssembleChapterInput): Promise<ChapterDraft>;
}
```

### 5.4 Diagnostics Service

```ts
export interface DiagnosticsService {
  diagnoseChapter(input: DiagnoseChapterInput): Promise<DiagnosticsReport>;
}
```

### 5.5 Revision Service

```ts
export interface RevisionService {
  createRevisionPlan(input: CreateRevisionPlanInput): Promise<RevisionPlan>;
  reviseDraft(input: ReviseDraftInput): Promise<ChapterDraft>;
}
```

### 5.6 Memory Service

```ts
export interface MemoryService {
  extractCanonPatch(input: ExtractCanonPatchInput): Promise<CanonPatch>;
  applyCanonPatch(projectId: string, patch: CanonPatch): Promise<StoryState>;
  createSnapshot(projectId: string, reason: string): Promise<SnapshotMeta>;
  rollback(projectId: string, snapshotId: string): Promise<void>;
}
```

## 6. Service 之间的数据流

```text
StateService.loadState()
  ↓
PlanningService.planChapterMission()
  ↓
PlanningService.generatePlanCandidates()
  ↓
PlanningService.rankPlanCandidates()
  ↓
PlanningService.generateSceneCards()
  ↓
ProductionService.writeScene() × N
  ↓
ProductionService.assembleChapter()
  ↓
DiagnosticsService.diagnoseChapter()
  ↓
RevisionService.createRevisionPlan() [if needed]
  ↓
RevisionService.reviseDraft() [if needed]
  ↓
MemoryService.extractCanonPatch()
  ↓
MemoryService.applyCanonPatch()
  ↓
SnapshotStore.createSnapshot()
```

## 7. Quality Gate 设计

```ts
export interface QualityGateConfig {
  minTotalScore: number; // default 8.2
  requiredHardChecks: string[];
  maxRevisionAttempts: number;
}
```

通过条件：

1. `diagnostics.hardFailures.length === 0`
2. `diagnostics.scores.total >= config.minTotalScore`
3. `diagnostics.missionSatisfaction.allRequiredSatisfied === true`
4. `canonPatch` schema valid

## 8. Artifact 写入策略

所有阶段必须写入 artifacts。禁止只在内存中传递最终结果。

原因：

- 支持调试。
- 支持人类手动编辑。
- 支持失败恢复。
- 支持训练/优化 prompt。

写入模式：

```text
write temp file
fsync if feasible
rename temp to final
validate if JSON
log artifact path
```

## 9. Prompt 渲染策略

Prompt 不应硬编码在业务代码中。应从 `prompts/` 读取模板。

模板输入建议使用 clearly delimited blocks：

```text
<story_state_json>
...
</story_state_json>

<chapter_mission_json>
...
</chapter_mission_json>
```

JSON 输出必须：

- 禁止 markdown code fence。
- 禁止解释性前后缀。
- 只输出 JSON。

## 10. 错误模型

```ts
export class AppError extends Error {
  code: string;
  category: 'validation' | 'io' | 'llm' | 'state' | 'logic' | 'unknown';
  recoverable: boolean;
  details?: unknown;
}
```

推荐错误码：

- `PROJECT_NOT_FOUND`
- `INVALID_PROJECT_ID`
- `SCHEMA_VALIDATION_FAILED`
- `LLM_INVALID_JSON`
- `LLM_PROVIDER_ERROR`
- `QUALITY_GATE_FAILED`
- `STATE_PATCH_CONFLICT`
- `ARTIFACT_WRITE_FAILED`

## 11. State Patch 应用原则

Canon Patch 不能直接覆盖整个 Story State。必须走 patch apply：

1. 校验 patch schema。
2. 检查 patch 引用的 chapter 是否正确。
3. 检查 ID 是否重复。
4. 检查关闭 debt/foreshadowing 时目标存在。
5. 检查角色知识更新不与 reader state/reveal schedule 冲突。
6. 生成新 Story State。
7. 校验新 Story State。
8. 保存 snapshot。
9. 原子写入 state。

## 12. Mock 优先开发策略

Codex 应先实现 mock 模式，因为这能验证工程结构，而不受 LLM 波动影响。

Mock fixtures：

```text
tests/fixtures/llm/
  build_story_bible.md
  plan_chapter_mission.json
  plan_candidates.json
  scene_cards.json
  write_scene_001.md
  diagnose_chapter_pass.json
  extract_canon_patch.json
```

## 13. 扩展点

v1 架构必须预留：

- `ProviderFactory`：替换不同 LLM。
- `PromptPack`：替换不同题材/风格 prompt。
- `StorageBackend`：未来替换为数据库。
- `DiagnosticsRule`：新增专项检查器。
- `GenreContract`：新增题材规则。
- `ExportFormat`：未来导出 epub、docx、平台格式。

## 14. 禁止事项

- 不要把完整系统写成一个巨大脚本。
- 不要让 CLI 直接调用 provider SDK。
- 不要让 LLM 输出未经 schema 校验就写入 state。
- 不要在失败时覆盖已提交 state。
- 不要把正文作为唯一事实来源；必须抽取 canon patch。
- 不要跳过 artifacts 保存。
