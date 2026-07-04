# 验收测试与 QA 计划：Novel Loop Engine

## 1. 验收原则

系统验收不以“生成的小说是否主观好看”为唯一标准。v1 验收重点是：

1. loop 是否完整。
2. state 是否可维护。
3. artifacts 是否完整。
4. schema 是否严格。
5. mock mode 是否可复现。
6. 失败时是否不破坏已提交数据。
7. 人类是否可以编辑后继续。

## 2. 测试层级

| 层级 | 目标 |
|---|---|
| Unit Tests | schema、文件写入、patch apply、quality gate 等纯逻辑 |
| Fixture Tests | 使用固定输入输出验证 parser 和 prompt response handling |
| Integration Tests | mock provider 跑完整章节 loop |
| CLI Smoke Tests | 真实命令行行为 |
| Regression Tests | 保证已修 bug 不复发 |
| Manual QA | 人类阅读 final 和 artifacts，检查体验 |

## 3. 核心 Gherkin 场景

### 3.1 初始化项目

```gherkin
Feature: Project initialization

Scenario: Initialize a new project from brief
  Given a valid brief file exists
  When I run "novel-loop init demo-novel --brief ./brief.md"
  Then the project directory "projects/demo-novel" should exist
  And "brief.md" should be copied into the project
  And "config.json" should exist
  And "state/story_state.json" should exist
  And project validation should pass
```

### 3.2 防止覆盖已有项目

```gherkin
Scenario: Prevent accidental overwrite
  Given project "demo-novel" already exists
  When I run "novel-loop init demo-novel --brief ./brief.md"
  Then the command should fail with exit code 2
  And existing files should not be modified
```

### 3.3 生成 Story Bible

```gherkin
Scenario: Build story bible with mock provider
  Given project "demo-novel" exists
  When I run "novel-loop build-bible demo-novel --provider mock"
  Then "strategy/story_bible.md" should exist
  And "strategy/genre_contract.md" should exist
  And "strategy/reader_promise.md" should exist
  And "strategy/style_guide.md" should exist
  And the run manifest should include prompt artifacts
```

### 3.4 生成全书规划

```gherkin
Scenario: Plan global outline
  Given story bible exists
  When I run "novel-loop plan-global demo-novel --provider mock"
  Then "planning/global_outline.md" should exist
  And "planning/chapter_queue.json" should pass schema validation
  And "state/reveal_schedule.json" should pass schema validation
```

### 3.5 完整章节 loop

```gherkin
Scenario: Run chapter loop to committed state
  Given project "demo-novel" has story bible and global outline
  And mock provider fixtures are configured
  When I run "novel-loop chapter demo-novel 1 --provider mock --max-revisions 2"
  Then "chapters/chapter_001/mission.json" should exist
  And "chapters/chapter_001/selected_plan.md" should exist
  And "chapters/chapter_001/scene_cards.json" should exist
  And "chapters/chapter_001/draft_v1.md" should exist
  And "chapters/chapter_001/diagnostics_v1.json" should exist
  And "chapters/chapter_001/final.md" should exist
  And "chapters/chapter_001/canon_patch.json" should exist
  And "state/story_state.json" should have latestCommittedChapter equal to 1
  And project validation should pass
```

### 3.6 诊断失败触发修订

```gherkin
Scenario: Diagnostics failure triggers revision
  Given mock provider returns a failing diagnostics report for draft_v1
  When I run chapter loop
  Then "revision_plan_v1.json" should exist
  And "draft_v2.md" should exist
  And diagnostics should run again on draft_v2
```

### 3.7 超过修订次数进入人工审核

```gherkin
Scenario: Max revision attempts reached
  Given mock provider always returns diagnostics with hard failures
  When I run "novel-loop chapter demo-novel 1 --provider mock --max-revisions 1"
  Then the chapter status should be "human_review_required"
  And existing state should not be committed
  And an error or review report should be saved
```

### 3.8 Canon Patch 冲突拒绝提交

```gherkin
Scenario: Reject conflicting canon patch
  Given canon patch attempts to close a non-existing debt
  When applyCanonPatch is called
  Then it should fail with STATE_PATCH_CONFLICT
  And story_state.json should remain unchanged
```

### 3.9 人类编辑 final 后提交

```gherkin
Scenario: Commit manually edited final chapter
  Given "chapters/chapter_001/final.md" was manually edited
  When I run "novel-loop commit-chapter demo-novel 1 --provider mock"
  Then a new canon patch should be extracted
  And state should be updated
  And a snapshot should be created
```

### 3.10 回滚状态

```gherkin
Scenario: Rollback to previous snapshot
  Given at least two snapshots exist
  When I run "novel-loop rollback demo-novel --to-snapshot snapshot_001"
  Then state should match snapshot_001
  And chapter artifacts should remain on disk
  And rollback log should be written
```

## 4. Unit Test Matrix

| 模块 | 测试内容 |
|---|---|
| ConfigSchema | valid/invalid config |
| StoryStateSchema | minimal state、full state、invalid ID、missing readerState |
| NarrativeDebtSchema | status、importance、payoff target 合法性 |
| ChapterMissionSchema | must objectives、forbiddenMoves |
| SceneCardSchema | beat list 非空、order 合法 |
| DiagnosticsReportSchema | scores 0-10、hard failures |
| RevisionPlanSchema | strategy enum、operations 非空 |
| CanonPatchSchema | empty patch、full patch、invalid action |
| FileStore | atomic write、read JSON、write JSON validation |
| ProjectPaths | path generation、chapter padding |
| SnapshotStore | create/list/load snapshots |
| QualityGate | pass、hard failure fail、low score fail |
| ApplyCanonPatch | create fact、update debt、conflict reject |
| JsonResponseParser | pure JSON、code fence JSON、invalid JSON |

## 5. Integration Test Matrix

### 5.1 Mock Happy Path

输入：brief fixture  
Provider：mock  
期望：完整 chapter 1 committed。

### 5.2 Mock Revision Path

输入：brief fixture  
Provider：mock  
行为：diagnostics_v1 失败，revision 后通过。  
期望：draft_v2 final。

### 5.3 Mock Human Review Path

Provider：mock always fail diagnostics。  
期望：human_review_required，state 不更新。

### 5.4 Invalid JSON Path

Provider：mock returns invalid JSON for mission。  
期望：调用 JSON repair；repair 失败时退出并保存 raw response。

### 5.5 Patch Conflict Path

Provider：mock returns conflicting canon patch。  
期望：commit 拒绝，state 不变，error artifact 存在。

## 6. CLI 验收命令

```bash
pnpm build
pnpm test

pnpm novel-loop init demo-novel --brief ./examples/brief.md
pnpm novel-loop validate demo-novel
pnpm novel-loop build-bible demo-novel --provider mock
pnpm novel-loop plan-global demo-novel --provider mock
pnpm novel-loop chapter demo-novel 1 --provider mock
pnpm novel-loop inspect demo-novel --debts --characters --reader
pnpm novel-loop validate demo-novel --strict
```

## 7. 质量门槛

### 7.1 工程质量

- P0 tests 全部通过。
- TypeScript build 无错误。
- lint 无 P0 问题。
- mock integration test 稳定通过。

### 7.2 Artifact 完整性

每章必须存在：

- mission.json
- selected_plan.md
- scene_cards.json
- draft_v1.md
- diagnostics 至少一份
- final.md 或 human_review_report.md
- canon_patch.json，如果 committed
- commit_report.json，如果 committed

### 7.3 State 完整性

- state schema valid。
- latestCommittedChapter 单调递增，rollback 除外。
- narrative debt 状态合法。
- reveal schedule 合法。
- reader state 不包含明显重复项，v1 可用简单去重。

### 7.4 诊断质量

Diagnostics report 必须：

- 指明 hard failures。
- 给出每个 soft score。
- 对未满足 mission objectives 给 evidence。
- issues 至少包含 message 和 recommendation。

### 7.5 修订质量

Revision plan 必须：

- 指向具体 target。
- 给出 operation。
- 给出 reason。
- 给出 instruction。
- 不允许只有“优化一下文笔”这类不可执行指令。

## 8. Manual QA Checklist

人工阅读一章 final 时检查：

```text
[ ] 本章有明确开端、推进、转折、结尾钩子
[ ] 主角行为符合当前人设和知识状态
[ ] 没有提前泄露计划中的秘密
[ ] 没有违反世界规则
[ ] 至少推进一个剧情线或人物弧光
[ ] 至少维护/升级/偿还一个叙事债务
[ ] 语言风格符合 style guide
[ ] canon patch 没有发明正文中不存在的事实
[ ] reader state 更新合理
[ ] 下一章有清晰可继续的入口
```

## 9. 回归测试建议

每次修改以下模块必须跑完整 integration test：

- schema
- applyCanonPatch
- runChapterLoop
- PromptService
- LLMClient
- FileStore
- Diagnostics/Revision

## 10. 发布前验收

v1 发布前必须完成：

```text
[ ] README 中有安装与 demo 说明
[ ] examples/brief.md 存在
[ ] mock full loop 可跑通
[ ] 主要 CLI 命令有 --help
[ ] .env.example 存在
[ ] 所有 P0 schema 有测试
[ ] 错误码文档化
[ ] 不需要真实 API key 也能跑测试
```
