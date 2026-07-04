# 安全、隐私与风险说明：Novel Loop Engine

## 1. 数据资产分类

Novel Loop Engine 会处理用户原创内容。需要保护的数据包括：

- brief
- story bible
- outline
- 未发布章节
- 角色设定
- 世界观规则
- 伏笔和 reveal schedule
- prompt 输入输出
- LLM provider API key
- run logs

其中 reveal schedule、reader state、narrative debts 等可能包含整本书的核心秘密，应视为高敏感创作资产。

## 2. 默认安全原则

1. 本地优先：默认所有项目数据保存在本地。
2. 最小外发：只有用户配置真实 provider 时，才向外部 LLM 服务发送必要上下文。
3. API key 不入库：API key 只从环境变量读取，不写入 run artifacts。
4. 可选脱敏：支持不保存完整 prompt 或保存 hash。
5. 明确错误：provider 调用失败时不应打印 API key 或完整隐私路径。

## 3. .env 要求

`.env.example` 可以包含：

```text
NOVEL_LOOP_PROVIDER=mock
NOVEL_LOOP_API_KEY=
NOVEL_LOOP_MODEL=
NOVEL_LOOP_PROJECTS_ROOT=./projects
```

`.env` 必须加入 `.gitignore`。

## 4. Prompt 日志风险

完整 prompt 中会包含大量作品设定和未发布剧情。如果保存完整 prompt，需要提醒用户。

建议提供配置：

```json
{
  "observability": {
    "saveRenderedPrompts": true,
    "redactPromptBodies": false,
    "saveProviderRawResponse": true
  }
}
```

如果 `redactPromptBodies=true`：

- 保存 prompt hash。
- 保存输入 artifact path。
- 不保存完整 prompt text。

## 5. LLM Provider 风险

外部 provider 可能：

- 记录请求。
- 返回不稳定输出。
- 返回格式不合法 JSON。
- 误解私密设定。
- 出现速率限制或费用波动。

工程缓解：

- provider adapter 隔离。
- mock mode 测试。
- JSON schema 验证。
- retry/backoff。
- cost tracking。
- prompt input 最小化。

## 6. 状态污染风险

最大工程风险之一是 LLM 生成的错误 canon patch 污染 Story State。

缓解措施：

1. Canon Patch 必须经过 schema 校验。
2. Apply Patch 必须检测引用和冲突。
3. Commit 前创建 snapshot。
4. Commit report 必须列出所有 state changes。
5. 人类可 rollback。
6. 不允许 LLM 直接覆盖完整 story_state。

## 7. 内容一致性风险

AI 可能生成：

- 与世界规则冲突的情节。
- 角色知道不该知道的信息。
- 提前泄露反转。
- 回收错误伏笔。

缓解措施：

- diagnostics hard checks。
- reveal schedule。
- character knowledge model。
- reader state。
- narrative debt tracker。

## 8. 版权与原创性风险

系统应避免要求模型模仿特定在世作者或直接续写受版权保护作品。工程层面建议：

- Style guide 使用抽象风格描述，而不是“模仿名家”。
- brief 中如出现“照着某作品写”，系统可提示用户改为题材/节奏/氛围描述。
- 不内置受版权保护文本作为 prompt fixture。

## 9. 文件系统风险

- 路径穿越：projectId 必须校验。
- 覆盖文件：默认不覆盖已有 strategy/planning 文件，除非 `--force`。
- 并发写入：同一项目运行时使用 lock file。
- 部分写入：atomic write。

## 10. 失败模式清单

| 风险 | 后果 | 缓解 |
|---|---|---|
| LLM 返回无效 JSON | loop 中断 | JSON repair + schema validation |
| patch 冲突 | state 被污染 | reject + snapshot + human review |
| prompt 太长 | provider 失败 | context summary + state slicing |
| 人设漂移 | 长篇质量下降 | character state + diagnostics |
| 伏笔遗忘 | 读者期待落空 | narrative debt tracker |
| 提前泄密 | 悬念破坏 | reader state + reveal schedule |
| 覆盖人类编辑 | 数据丢失 | no overwrite by default + snapshots |
| API key 泄露 | 安全事故 | env only + redacted logs |

## 11. 人类审核建议

以下情况必须进入 human review：

- hard world rule conflict。
- reveal schedule 冲突。
- Canon Patch 关闭不存在的 debt。
- 角色知识冲突无法自动修复。
- 多轮 revision 仍低于质量线。
- LLM 输出明显偏离 story bible。

## 12. 生产化路线风险

如果未来做 SaaS，需要额外考虑：

- 用户认证。
- 项目隔离。
- 多租户数据安全。
- 加密存储。
- 队列和任务取消。
- 审计日志。
- 成本限制。
- 法务条款。

这些不属于 v1 本地 CLI 范围。
