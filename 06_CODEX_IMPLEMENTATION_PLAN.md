# Codex 实施计划：Novel Loop Engine

## 1. 实施原则

1. 先实现可测试的骨架，再接真实 LLM。
2. 先做 mock provider，确保完整 loop 可复现。
3. 所有关键 JSON 先写 schema，再写业务代码。
4. 每个 Milestone 都必须有可运行命令和测试。
5. 不要一次性实现 Web UI、数据库、向量检索。
6. 不要牺牲 artifacts 留痕；所有中间结果都要写文件。
7. 不要让 LLM 输出直接污染 state；必须通过 schema 和 patch apply。

## 2. 推荐技术栈

- TypeScript
- Node.js 20+
- pnpm
- Commander：CLI
- Zod：schema
- Vitest：测试
- pino：日志
- dotenv：环境变量
- prettier/eslint：格式和 lint

如果 Codex 发现项目已有技术栈，应优先保持一致，但必须保留上述架构原则。

## 3. Milestone 计划

### M0：项目骨架

目标：创建可运行 TypeScript CLI 项目。

任务：

- 初始化 package。
- 配置 TypeScript。
- 配置 Vitest。
- 创建 `src/cli/index.ts`。
- 实现 `novel-loop --help`。
- 创建基础目录结构。

验收：

```bash
pnpm install
pnpm build
pnpm test
pnpm novel-loop --help
```

### M1：Schema 与类型

目标：实现核心 schema。

任务：

- 实现 `ConfigSchema`。
- 实现 `StoryStateSchema`。
- 实现 `CharacterStateSchema`。
- 实现 `NarrativeDebtSchema`。
- 实现 `ForeshadowingSchema`。
- 实现 `ReaderStateSchema`。
- 实现 `ChapterMissionSchema`。
- 实现 `SceneCardSchema`。
- 实现 `DiagnosticsReportSchema`。
- 实现 `RevisionPlanSchema`。
- 实现 `CanonPatchSchema`。
- 从 schema 导出 TypeScript 类型。

验收：

- schema unit tests 通过。
- invalid fixtures 被拒绝。
- valid fixtures 通过。

### M2：FileStore、路径和 atomic write

目标：实现项目文件读写基础设施。

任务：

- `ProjectPaths`：统一生成项目路径。
- `FileStore.readText/writeText/readJson/writeJson/exists/list`。
- `AtomicWriter`：tmp + rename。
- `SnapshotStore`：创建和读取 state snapshots。
- `RunLogger`：创建 run manifest、记录 artifacts、错误。

验收：

- unit tests 覆盖写入、读取、atomic write、snapshot。
- 文件路径兼容 Windows path join。

### M3：init 与 validate 命令

目标：可以创建项目并校验。

任务：

- `novel-loop init <projectId> --brief <path>`。
- 创建标准目录。
- 复制 brief。
- 写默认 config。
- 写初始 story_state。
- `novel-loop validate <projectId>`。
- 输出可读校验结果。

验收：

```bash
novel-loop init demo-novel --brief ./examples/brief.md
novel-loop validate demo-novel
```

### M4：PromptService 与 MockLLMClient

目标：业务代码可以通过统一接口调用 prompt。

任务：

- `PromptService` 加载 prompt templates。
- `TemplateRenderer` 替换 `{{PLACEHOLDER}}`。
- `LLMClient` interface。
- `MockLLMClient` 基于 promptId 返回 fixture。
- `JsonResponseParser` 解析 JSON 并处理 code fence。
- provider factory。

验收：

- mock prompt 调用测试通过。
- JSON parser 能处理正常 JSON 和错误 JSON。

### M5：build-bible 与 plan-global

目标：能生成故事基础材料。

任务：

- 实现 `buildBible` service。
- 写入 story_bible、genre_contract、reader_promise、style_guide。
- 实现 `planGlobal` service。
- 写入 global_outline、volume outline、arc_map、chapter_queue。
- 使用 mock fixture。

验收：

```bash
novel-loop build-bible demo-novel --provider mock
novel-loop plan-global demo-novel --provider mock
```

### M6：Chapter Mission 与 Plan Candidates

目标：章节 loop 的前半部分可运行。

任务：

- `planChapterMission`。
- `generatePlanCandidates`。
- `rankPlanCandidates`。
- 写入 mission、plan candidates、ranking、selected plan。
- 支持 `--candidates`。

验收：

```bash
novel-loop chapter demo-novel 1 --provider mock --dry-run
```

至少生成 mission 和 selected plan。

### M7：Scene Cards、写作、组装

目标：生成章节草稿。

任务：

- `generateSceneCards`。
- `writeScene`。
- `assembleChapter`。
- 写入 scene drafts 和 `draft_v1.md`。

验收：

- mock mode 生成完整 draft。
- scene 数量符合 config。

### M8：Diagnostics 与 Revision Loop

目标：章节可以被诊断和修订。

任务：

- `diagnoseChapter`。
- quality gate。
- `createRevisionPlan`。
- `reviseDraft`。
- 支持多轮 revision。
- 超过最大轮次进入 human review。

验收：

- 通过 fixture 模拟：第一次诊断失败，修订后通过。
- 生成 `diagnostics_v1.json`、`revision_plan_v1.json`、`draft_v2.md`、`diagnostics_v2.json`。

### M9：Canon Patch 与 State Commit

目标：最终章节可以提交到 Story State。

任务：

- `extractCanonPatch`。
- `applyCanonPatch`。
- patch conflict checks。
- snapshot before/after commit。
- 写入 `commit_report.json`。
- 更新 `latestCommittedChapter`。

验收：

- chapter 1 完整跑到 committed。
- state 更新符合 patch。
- rollback 能恢复。

### M10：inspect、rollback、commit-chapter

目标：增强人工接管能力。

任务：

- `inspect` 输出 debts、characters、reader state 摘要。
- `rollback` 回滚 snapshot。
- `commit-chapter` 从手动 final 重新抽取 patch。

验收：

- 手动编辑 final 后可 commit。
- rollback 不删除章节 artifacts。

### M11：真实 Provider 接入

目标：支持真实模型调用。

任务：

- 实现一个真实 provider adapter。
- 从 `.env` 读取 API key。
- 保存 usage metadata。
- 实现 retry/backoff。
- 实现 JSON repair fallback。

验收：

- mock tests 不依赖 API key。
- provider 不可用时错误分类清晰。

## 4. P0 任务清单

```text
[ ] TS 项目骨架
[ ] CLI help
[ ] 所有核心 Zod schema
[ ] ProjectPaths
[ ] FileStore + atomic write
[ ] SnapshotStore
[ ] RunLogger
[ ] init 命令
[ ] validate 命令
[ ] PromptService
[ ] MockLLMClient
[ ] build-bible 命令
[ ] plan-global 命令
[ ] chapter loop：mission
[ ] chapter loop：plan candidates
[ ] chapter loop：rank selected plan
[ ] chapter loop：scene cards
[ ] chapter loop：write scenes
[ ] chapter loop：assemble draft
[ ] diagnostics
[ ] revision plan
[ ] revise draft
[ ] quality gate
[ ] canon patch extraction
[ ] apply canon patch
[ ] commit report
[ ] snapshots
[ ] integration test：mock full chapter
```

## 5. P1 任务清单

```text
[ ] inspect 命令
[ ] rollback 命令
[ ] commit-chapter 命令
[ ] JSON repair prompt
[ ] retry/backoff
[ ] provider adapter
[ ] cost/token tracking
[ ] prompt input/output redaction options
[ ] better error display
[ ] examples/demo project
```

## 6. 推荐实现顺序给 Codex

Codex 不应从 prompt 开始写。应按这个顺序：

```text
1. package + CLI skeleton
2. schemas
3. storage
4. init/validate
5. prompt service + mock llm
6. build-bible/plan-global
7. chapter loop orchestration with mock outputs
8. diagnostics/revision loop
9. canon patch/state commit
10. tests and docs
```

## 7. 测试要求

每个 Milestone 至少包含：

- unit tests
- fixture tests
- one CLI smoke test if applicable

关键 integration test：

```text
Given a brief fixture
When user runs init, build-bible, plan-global, chapter 1 with mock provider
Then chapter_001/final.md exists
And chapter_001/canon_patch.json exists
And story_state.latestCommittedChapter equals 1
And validate passes
```

## 8. Codex 编码规范

- 使用严格 TypeScript。
- 使用 async/await，不混用 callback。
- 不使用 any，除非边界层 raw provider response。
- 每个 service 函数输入输出有类型。
- 所有 JSON 写入前 parse/validate。
- 路径用 `path.join`，不要硬拼 `/`。
- 不在业务逻辑中 `console.log`，使用 logger 或返回结果。
- prompt 模板放 `prompts/`，不要硬编码长 prompt。
- schema 与领域逻辑分开。

## 9. Definition of Done

一个功能完成必须满足：

1. 有类型。
2. 有 schema，如果涉及 JSON artifact。
3. 有测试。
4. 有 CLI 或 service 入口。
5. 有错误处理。
6. 有 artifact 写入，如果是 loop 阶段。
7. 有 README 或命令说明更新。

## 10. 第一个可交付版本命令演示

最终 v1 demo 应该能这样跑：

```bash
pnpm install
pnpm build

pnpm novel-loop init demo-novel --brief ./examples/brief.md
pnpm novel-loop build-bible demo-novel --provider mock
pnpm novel-loop plan-global demo-novel --provider mock
pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2
pnpm novel-loop inspect demo-novel --debts --reader
pnpm novel-loop validate demo-novel
```

期望输出：

```text
projects/demo-novel/
  strategy/story_bible.md
  planning/global_outline.md
  chapters/chapter_001/final.md
  chapters/chapter_001/diagnostics_v2.json
  chapters/chapter_001/canon_patch.json
  state/story_state.json
  snapshots/...
```
