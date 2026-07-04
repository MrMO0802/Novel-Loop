# 运行、观察性与可复现性说明：Novel Loop Engine

## 1. 为什么需要运行观察性

AI 小说 loop 不是一次性函数调用，而是多阶段、长链路、可失败、可修订的生产流程。没有 run logs 和 artifacts，系统无法 debug、无法复盘、无法优化 prompt，也无法判断是哪一步导致质量下降。

## 2. Run ID

每次 CLI 命令执行必须生成 run id。

格式建议：

```text
run_YYYYMMDD_HHMMSS_<shortRandom>
```

示例：

```text
run_20260702_102530_a13f9c
```

## 3. Run Manifest

每个 run 必须创建：

```text
runs/<runId>/run_manifest.json
```

示例：

```json
{
  "runId": "run_20260702_102530_a13f9c",
  "projectId": "demo-novel",
  "command": "chapter",
  "args": {
    "chapterNumber": 1,
    "provider": "mock",
    "maxRevisions": 2
  },
  "status": "completed",
  "startedAt": "2026-07-02T02:25:30.000Z",
  "endedAt": "2026-07-02T02:26:10.000Z",
  "artifacts": [
    "chapters/chapter_001/mission.json",
    "chapters/chapter_001/final.md"
  ],
  "llmCalls": [],
  "errors": []
}
```

## 4. LLM Call 记录

每次 LLM 调用必须记录 metadata。

建议保存：

```text
runs/<runId>/llm_calls/<index>_<promptId>/
  request.json
  response.txt 或 response.json
  parsed.json
  error.json 如果失败
```

`request.json` 应包含：

- promptId
- provider
- model
- responseFormat
- temperature
- maxTokens
- inputArtifactPaths
- renderedPromptPath

为了保护作品内容，可提供 `--redact-prompts` 选项，只保存摘要和 hash。

## 5. Artifact 目录规范

章节 artifacts 应在章节目录中保存，run 目录中保存调用记录和 manifest。不要只存一份。

```text
chapters/chapter_001/       # 创作产物，长期保留
runs/run_xxx/               # 运行记录，调试和审计
snapshots/                  # state 快照
```

## 6. Checkpoint 策略

Chapter loop 每个阶段完成后都应 checkpoint：

```text
mission created
plan candidates generated
plan selected
scene cards generated
draft generated
diagnostics generated
revision generated
final generated
canon patch extracted
state committed
```

失败时系统应输出：

```text
Failed at stage: diagnostics
Last completed artifact: chapters/chapter_001/draft_v1.md
Suggested resume command: novel-loop chapter demo-novel 1 --resume run_xxx
```

v1 可先不实现 resume，但要把 checkpoint 信息写入 manifest，为 v2 保留。

## 7. Snapshot 策略

State 更新前必须创建 snapshot。

时机：

- init 后。
- build-bible 后，如果 state 改变。
- chapter commit 前。
- rollback 前。

snapshot 内容：

- story_state.json 全量。
- config hash。
- commit reason。
- source chapter/run id。

## 8. 日志等级

| 等级 | 用途 |
|---|---|
| debug | 调试细节，默认不显示 |
| info | 阶段开始/完成、artifact 写入 |
| warn | 可恢复问题、低风险 schema warning |
| error | 命令失败、provider 失败、patch conflict |

CLI 默认显示 info/warn/error。可通过 `--verbose` 显示 debug。

## 9. 成本和 token 统计

如果 provider 提供 usage，系统应记录：

- input tokens
- output tokens
- total tokens
- estimated cost
- promptId 汇总
- run 汇总

输出示例：

```text
LLM usage:
- calls: 9
- input tokens: 82,100
- output tokens: 24,500
- estimated cost: $1.23
```

## 10. 可复现性

mock mode 必须完全可复现。

真实 LLM mode 无法完全可复现，但仍应保存：

- provider
- model
- temperature
- prompt version
- prompt text hash
- input artifact hash
- output hash

## 11. Prompt 版本管理

Prompt 文件变化会影响输出。建议每次 run 记录：

```json
{
  "promptId": "planning.plan_chapter_mission",
  "promptPath": "prompts/planning/plan_chapter_mission.md",
  "promptHash": "sha256:..."
}
```

## 12. 数据完整性检查

`validate --strict` 应检查：

- JSON schema。
- chapter lifecycle。
- state latestCommittedChapter 与 chapters 目录一致。
- open debts 的 payoffTargetChapter 合法。
- reveal schedule 不冲突。
- canon facts source chapter 不超过 latestCommittedChapter。
- role/character ids 引用有效。

## 13. 失败恢复策略

### 13.1 LLM 调用失败

- transient：retry with backoff。
- invalid JSON：调用 JSON repair。
- repair failed：保存 raw output，命令失败。

### 13.2 Artifact 写入失败

- 不更新 manifest status 为 completed。
- 保留 temp 文件路径，如果存在。
- 返回 `ARTIFACT_WRITE_FAILED`。

### 13.3 Patch 冲突

- 拒绝更新 state。
- 保存 conflict report。
- 标记 chapter 为 `human_review_required`。

### 13.4 Quality Gate 失败

- 如果未达到 max revisions，继续修订。
- 如果达到上限，保存 human review report。
- 不提交 canon patch。

## 14. Human Review Report

当进入人工审核时生成：

```text
chapters/chapter_001/human_review_report.md
```

内容：

```md
# Human Review Required

## Reason
...

## Last Diagnostics
...

## Suggested Fixes
...

## Safe Resume Options
...
```

## 15. Inspect 输出建议

`inspect` 命令应提供快速状态摘要：

```text
Project: demo-novel
Latest committed chapter: 12
Open narrative debts: 9
Overdue debts: 1
Debts due within 3 chapters: 3
Unresolved foreshadowing: 6
Planned reveals hidden: 4
Characters: 7
Reader open questions: 5
```

## 16. 备份建议

v1 不强制云备份，但应建议用户：

- 把项目目录放进 Git。
- 不把 `.env` 提交。
- 大量 run artifacts 可以压缩归档。

## 17. 生产环境建议

如果未来服务化：

- storage 替换为数据库 + object storage。
- run queue 化。
- LLM 调用异步任务化。
- state commit 加事务锁。
- 项目级写锁防止并发章节提交冲突。

v1 本地 CLI 可用 lock file 防止同一项目并发运行：

```text
projects/<projectId>/.novel-loop.lock
```
