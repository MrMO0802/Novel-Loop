# Novel Loop Engine 开发材料索引

版本：v1.0  
日期：2026-07-02  
项目代号：Novel Loop Engine / AI 小说生产闭环系统

## 1. 项目一句话定义

Novel Loop Engine 是一个以 `Story State` 为核心的 AI 长篇小说创作引擎。它不是单次文本生成工具，而是通过多层规划、章节生产、自动诊断、策略修订、叙事债务追踪和 canon 状态提交，让 AI 能持续、可控、可追踪地生产长篇小说。

## 2. 本材料包包含什么

| 文件 | 用途 |
|---|---|
| `01_PRODUCT_REQUIREMENTS_PRD.md` | 产品需求文档，定义目标、范围、用户、核心流程和成功标准 |
| `02_SOFTWARE_REQUIREMENTS_SRS.md` | 软件需求规格说明书，定义功能性/非功能性需求与 CLI 行为 |
| `03_ARCHITECTURE_AND_MODULE_SPEC.md` | 技术架构、模块边界、目录结构、核心接口与 loop 状态机 |
| `04_DATA_MODEL_AND_SCHEMAS.md` | Story State、角色、伏笔、叙事债务、章节任务、诊断报告等数据模型 |
| `05_PROMPT_PACK.md` | 生产级 Prompt 模板与输入输出约束 |
| `06_CODEX_IMPLEMENTATION_PLAN.md` | 给 Codex 的分阶段开发计划、任务拆解和提交标准 |
| `07_ACCEPTANCE_TESTS_AND_QA.md` | 验收测试、质量门槛、Gherkin 场景和测试矩阵 |
| `08_OPERATIONS_OBSERVABILITY.md` | 运行日志、成本统计、checkpoint、可复现性、失败恢复和观察性 |
| `09_SECURITY_PRIVACY_RISK.md` | 安全、隐私、内容资产保护、LLM 调用风险和工程风险 |
| `10_CODEX_BOOTSTRAP_PROMPT.md` | 可直接复制给 Codex 的项目启动提示词 |

## 3. 默认技术假设

为了让 Codex 能直接落地，本文档默认采用以下 v1 技术方案：

- 语言：TypeScript
- 运行环境：Node.js 20+
- 交互方式：CLI 优先，暂不做 Web UI
- 存储方式：本地文件系统，Markdown + JSON
- 数据校验：Zod schema
- CLI 框架：Commander 或等效方案
- 日志：pino 或等效 JSON logger
- 测试：Vitest
- LLM 接入：通过统一 `LLMClient` 抽象，支持 mock provider 与真实 provider
- 主要目标：先把 Story State Engine、章节 loop、诊断与 canon patch 做扎实

## 4. v1 项目边界

v1 必须实现：

1. 初始化小说项目。
2. 从 brief 生成 Story Bible。
3. 生成全书/分卷/章节规划。
4. 维护结构化 Story State。
5. 生成章节任务 Mission。
6. 生成多个章节方案并选择最佳方案。
7. 生成场景卡。
8. 逐场景写作并组装章节。
9. 运行诊断，包括时间线、人设、角色知识、读者知识、伏笔、叙事债务、风格和节奏。
10. 生成修订计划并执行局部修订或整章重写。
11. 抽取 canon patch 并更新 Story State。
12. 保存完整 run artifacts，支持复盘、回滚和重跑。

v1 不做：

- 多用户 SaaS。
- 在线编辑器。
- 小说发布平台对接。
- 付费、权限、团队协作。
- 向量数据库/RAG 复杂检索，除非后续 v2 加入。
- 自动保证内容商业成功。

## 5. 给 Codex 的推荐使用方式

把整个目录作为项目上下文提供给 Codex，然后使用 `10_CODEX_BOOTSTRAP_PROMPT.md` 作为第一条指令。建议让 Codex 按 `06_CODEX_IMPLEMENTATION_PLAN.md` 的 Milestone 顺序实现，不要一次性做完整系统。

推荐第一阶段目标：

```text
M1：搭建 TypeScript CLI + 项目目录结构 + Zod schema + mock LLMClient
M2：实现 init、state validate、chapter mission planner 的 mock 版本
M3：实现完整本地 chapter loop，但使用 mock LLM 输出固定 fixture
M4：接入真实 LLM provider
M5：完善诊断、修订和 canon patch
```

## 6. 核心术语

- Story State：小说世界的结构化当前状态，包括 canon facts、人物状态、世界规则、时间线、读者知识、角色知识、伏笔和叙事债务。
- Canon：已经在最终正文中发生、确认并提交为事实的内容。
- Canon Patch：从最终章节中抽取出的状态变更补丁。
- Narrative Debt：叙事债务，即作品向读者承诺后续必须兑现的悬念、伏笔、关系推进、爽点或主题问题。
- Reader State：读者已经知道、怀疑、期待、尚不知道的信息集合。
- Character Knowledge：角色自身知道什么，不知道什么，误以为什么。
- Chapter Mission：某章在整本书中的功能任务。
- Scene Card：场景级写作计划，描述冲突、信息增量、情绪变化、进入点、退出点和叙事功能。
- Diagnostics：对草稿进行硬检查与软评分的结果。
- Revision Plan：面向草稿的可执行修订操作清单。
