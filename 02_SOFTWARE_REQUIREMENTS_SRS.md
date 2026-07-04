# 软件需求规格说明书 SRS：Novel Loop Engine

## 1. 系统范围

Novel Loop Engine v1 是一个本地 CLI 应用。系统读取项目目录中的 Markdown/JSON 文件，调用 LLM 或 mock provider 生成规划、正文、诊断、修订和状态补丁，并将所有 artifacts 写回项目目录。

系统不提供 Web 服务、不提供数据库服务、不管理用户登录、不负责付费或分发。

## 2. 系统参与者

| 参与者 | 说明 |
|---|---|
| Author | 小说作者，提供 brief，查看和编辑 artifacts |
| Editor | 人类编辑，可修改 story bible、chapter plan、final draft、state |
| LLM Provider | 外部模型服务或本地模型服务 |
| Mock Provider | 测试使用的确定性模拟 provider |
| CLI Runtime | 用户通过命令行触发流程 |

## 3. 运行环境

- Node.js 20+
- TypeScript 5+
- pnpm 或 npm
- macOS/Linux/Windows 兼容
- UTF-8 文件系统
- 推荐项目根目录包含 `.env`，但不强制

## 4. CLI 命令规格

### 4.1 `novel-loop init`

```bash
novel-loop init <projectId> --brief <path> [--root <projectsRoot>]
```

功能：创建新小说项目。

输入：

- `projectId`：项目 ID，只允许小写字母、数字、短横线、下划线。
- `--brief`：brief Markdown 文件路径。
- `--root`：项目根目录，默认 `./projects`。

输出：

- 标准项目目录。
- `config.json`。
- `brief.md`。
- 空状态文件。

错误：

- 项目已存在：退出码 2。
- brief 不存在：退出码 2。
- projectId 非法：退出码 2。

### 4.2 `novel-loop build-bible`

```bash
novel-loop build-bible <projectId> [--provider mock|openai|custom] [--force]
```

功能：根据 brief 生成 Story Bible、Genre Contract、Reader Promise、Style Guide。

输出：

- `strategy/story_bible.md`
- `strategy/genre_contract.md`
- `strategy/reader_promise.md`
- `strategy/style_guide.md`

约束：

- 如果文件已存在且没有 `--force`，不得覆盖。
- 必须保存 prompt 输入和输出到 `runs/<runId>/prompts/`。

### 4.3 `novel-loop plan-global`

```bash
novel-loop plan-global <projectId> [--volumes <n>] [--chapters <n>]
```

功能：生成全书大纲、分卷规划、初始 reveal schedule、arc map。

输出：

- `planning/global_outline.md`
- `planning/volume_01_outline.md`
- `planning/arc_map.json`
- `planning/chapter_queue.json`
- `state/reveal_schedule.json`

### 4.4 `novel-loop chapter`

```bash
novel-loop chapter <projectId> <chapterNumber|next> \
  [--candidates <n>] \
  [--max-revisions <n>] \
  [--provider mock|openai|custom] \
  [--dry-run]
```

功能：执行完整章节 loop。

输出目录：

```text
chapters/chapter_001/
  mission.json
  plan_candidates/
    plan_001.md
    plan_002.md
    plan_003.md
  plan_ranking.json
  selected_plan.md
  scene_cards.json
  scenes/
    scene_001_v1.md
    scene_002_v1.md
  draft_v1.md
  diagnostics_v1.json
  revision_plan_v1.json
  draft_v2.md
  diagnostics_v2.json
  final.md
  canon_patch.json
  commit_report.json
```

状态转移：

```text
NEW
→ MISSION_CREATED
→ PLANS_GENERATED
→ PLAN_SELECTED
→ SCENES_PLANNED
→ DRAFTED
→ DIAGNOSED
→ REVISED 或 FINALIZED
→ CANON_PATCHED
→ COMMITTED
```

### 4.5 `novel-loop validate`

```bash
novel-loop validate <projectId> [--strict]
```

功能：校验项目结构和 JSON schema。

必须检查：

- `config.json`
- state 下所有 JSON
- planning 下所有 JSON
- chapter artifacts 中的 JSON
- chapter lifecycle 状态

### 4.6 `novel-loop inspect`

```bash
novel-loop inspect <projectId> [--chapter <n>] [--debts] [--characters] [--reader]
```

功能：展示当前状态摘要。

输出示例：

```text
Open narrative debts: 7
Debts due within 3 chapters: 2
Active plot threads: 4
Unresolved foreshadowing: 5
Latest committed chapter: 12
```

### 4.7 `novel-loop rollback`

```bash
novel-loop rollback <projectId> --to-snapshot <snapshotId>
```

功能：回滚状态到某个 snapshot。

要求：

- 不删除章节正文。
- 将当前 state 保存为 rollback 前备份。
- 写入 rollback log。

### 4.8 `novel-loop commit-chapter`

```bash
novel-loop commit-chapter <projectId> <chapterNumber> [--from-final <path>]
```

功能：当人类手动编辑 final 后，重新抽取 canon patch 并提交状态。

## 5. 数据存储需求

### 5.1 项目目录结构

```text
projects/<projectId>/
  config.json
  brief.md
  strategy/
  state/
  planning/
  chapters/
  runs/
  snapshots/
```

### 5.2 写入要求

- 所有写入必须使用 atomic write：先写 `.tmp`，再 rename。
- 每次章节 loop 之前必须创建 run id。
- 每个 run 目录必须包含 `run_manifest.json`。
- 任何失败都必须写入 `error.json`。

### 5.3 文件命名规范

- 章节目录：`chapter_001`，三位数补零。
- 场景文件：`scene_001_v1.md`。
- 诊断文件：`diagnostics_v1.json`。
- 修订计划：`revision_plan_v1.json`。
- snapshot：`snapshot_YYYYMMDD_HHMMSS_<shortHash>.json`。

## 6. LLM Client 需求

### 6.1 统一接口

业务层不得直接依赖具体 provider SDK。必须通过 `LLMClient` 接口调用。

```ts
export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  promptId: string;
  system: string;
  user: string;
  responseFormat: 'markdown' | 'json';
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  json?: unknown;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  raw?: unknown;
}
```

### 6.2 Mock Provider

Mock Provider 必须支持：

- 按 `promptId` 返回 fixture。
- 测试中 deterministic。
- 可模拟失败、超时、无效 JSON。

### 6.3 Provider 错误分类

必须分类处理：

- transient network error
- provider rate limit
- invalid response format
- safety refusal / empty response
- schema validation failure
- unknown error

## 7. Schema 校验需求

所有关键 JSON 必须通过 Zod schema，包括：

- Config
- StoryState
- CharacterState
- NarrativeDebt
- Foreshadowing
- ReaderState
- ChapterMission
- SceneCard
- DiagnosticsReport
- RevisionPlan
- CanonPatch
- RunManifest

要求：

- schema 定义在 `src/schemas/`。
- 类型从 schema 推导，禁止手写重复类型。
- schema 错误必须输出可读路径。

## 8. 章节 loop 详细行为

### 8.1 前置校验

运行章节前必须执行：

1. 项目存在。
2. config 有效。
3. Story Bible 存在。
4. Global Outline 存在。
5. State 有效。
6. 目标章节未 committed，除非 `--force`。

### 8.2 叙事债务分析

系统根据当前 chapterNumber 计算：

- overdue debts
- due soon debts
- high importance debts
- debts to maintain
- debts to introduce

输出写入 mission。

### 8.3 方案生成与排序

至少生成 3 个候选方案。排序必须输出每个方案优缺点和量化评分。

### 8.4 草稿生成

场景写作必须逐场景进行，不允许直接一次生成整章，除非配置显式允许。

### 8.5 诊断与修订

每次诊断必须输出：

- hard failures
- soft scores
- issue list
- revision recommendations

如果 hard failures 不为空，必须进入修订或 human_review。

### 8.6 Finalize 条件

章节满足以下条件才可 final：

- hard failures 为空。
- soft score 总分 >= config.qualityThreshold，默认 8.2。
- mission required objectives 全部 marked satisfied。
- no invalid JSON/state changes。

## 9. 错误处理需求

- 所有 CLI 命令错误必须有明确 exit code。
- 所有异常必须写入 run log。
- LLM 无效 JSON 时，系统应尝试一次 format repair。
- 修复失败则保存 raw response 并退出。
- 状态更新失败必须回滚到更新前 snapshot。

## 10. 配置需求

`config.json` 示例：

```json
{
  "projectId": "demo-novel",
  "language": "zh-CN",
  "defaultProvider": "mock",
  "qualityThreshold": 8.2,
  "chapter": {
    "defaultCandidateCount": 3,
    "maxRevisionAttempts": 3,
    "targetWordCount": 3500,
    "sceneMinCount": 3,
    "sceneMaxCount": 8
  },
  "llm": {
    "temperature": {
      "planning": 0.6,
      "writing": 0.85,
      "diagnostics": 0.2,
      "revision": 0.45
    }
  },
  "storage": {
    "snapshotOnCommit": true,
    "atomicWrites": true
  }
}
```

## 11. 性能需求

v1 不追求高并发，但应满足：

- 单命令内串行执行可接受。
- 场景写作可设计为未来可并行，但 v1 默认串行以保证上下文一致。
- 大文件读取应有上限警告。
- run artifacts 不应被自动删除。

## 12. 兼容性需求

- 中文小说为第一优先级。
- 文件内容必须 UTF-8。
- Windows 路径兼容。
- 不假设 shell 特有能力。

## 13. 可观测性需求

每次 run 必须记录：

- command args
- start/end time
- provider/model
- prompt ids
- artifacts paths
- token usage
- cost estimate
- retries
- status
- error details

## 14. 验收总则

系统达到 v1 完成状态必须满足：

1. 全部 P0 功能可运行。
2. mock integration test 可完整通过。
3. schema validation 覆盖所有 state artifacts。
4. 人类可手动编辑 final 后重新 commit。
5. 错误时不破坏已提交 state。
