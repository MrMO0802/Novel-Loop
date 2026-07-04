# 产品需求文档 PRD：Novel Loop Engine

## 1. 背景与问题

AI 已经可以生成单章小说文本，但在长篇创作中经常出现以下问题：

1. 前后矛盾：时间线、角色行为、世界观规则不一致。
2. 人设漂移：角色在不同章节中像不同的人。
3. 伏笔遗忘：前文承诺的问题没有回收。
4. 信息泄露：读者或角色提前知道不该知道的秘密。
5. 节奏失控：章节功能重复、高潮分布不合理、爽点或悬念过密/过稀。
6. 缺少可复盘性：一次聊天生成后，无法追踪为什么这么写、哪里修改过、哪些设定已成为 canon。
7. 难以工程化协作：没有稳定的数据结构、状态机和验收标准。

Novel Loop Engine 要解决的是“长篇小说持续生产的控制问题”，不是简单“让 AI 多写一点”。

## 2. 产品定位

Novel Loop Engine 是一个本地优先的 AI 长篇小说生产闭环系统，面向创作者、工作室和开发者，用结构化状态、任务规划、多候选方案、自动诊断、策略修订和 canon 状态更新，辅助持续创作可连载、可追踪、可修订的小说项目。

## 3. 产品目标

### 3.1 v1 目标

- 让用户可以从一个 brief 初始化一部小说项目。
- 自动生成并维护 Story Bible 与 Story State。
- 按章节执行可复现的创作 loop。
- 每章输出计划、场景卡、初稿、诊断报告、修订计划、最终稿和 canon patch。
- 保证所有核心数据都有 schema 校验。
- 在 mock LLM 模式下可以稳定通过测试。
- 在真实 LLM 模式下可以替换 provider，而不修改业务代码。

### 3.2 长期目标

- 支持多卷长篇连载。
- 支持向量检索与相似剧情检测。
- 支持多风格、多题材 genre contract。
- 支持编辑器 UI。
- 支持多人协作和版本管理。
- 支持读者反馈数据反哺后续规划。

## 4. 目标用户

### 4.1 独立网文作者

需求：提升长篇连载稳定性，减少人设崩坏和伏笔遗忘。  
价值：用状态系统和诊断系统辅助每日更新。

### 4.2 AI 写作工具开发者

需求：需要一个可扩展的创作 loop 框架。  
价值：提供稳定架构、schema、prompt 模板和模块边界。

### 4.3 小说工作室/内容团队

需求：多项目管理、统一风格、可复盘的生产流程。  
价值：标准化 story bible、chapter artifacts 和质量诊断。

## 5. 产品原则

1. 状态优先：正文是 Story State 的渲染结果，不是唯一资产。
2. 章节功能优先：每章必须服务于主线、人物弧光、伏笔或读者期待。
3. 先规划再写作：禁止直接从 brief 跳到正文。
4. 硬约束不可破：时间线、角色知识、世界规则、未授权信息揭露必须严格检查。
5. 软指标可优化：节奏、风格、钩子、情绪冲击、类型满足感通过评分和修订优化。
6. 全过程留痕：每个章节 loop 必须保存输入、输出、诊断、修订、状态补丁和日志。
7. 人类可接管：任何阶段都允许人类编辑 artifacts，然后继续运行。
8. 可复现：同样输入、同样配置、同样 mock provider 应产生一致结果。

## 6. 核心用户流程

### 6.1 初始化项目

```text
用户提供 brief.md
↓
系统创建项目目录
↓
生成默认配置
↓
生成初始空 Story State
```

CLI 示例：

```bash
novel-loop init my-novel --brief ./brief.md
```

### 6.2 构建故事基础

```text
brief
↓
Story Bible
↓
Genre Contract
↓
Reader Promise
↓
Global Outline
↓
Initial Story State
```

CLI 示例：

```bash
novel-loop build-bible my-novel
novel-loop plan-global my-novel
```

### 6.3 运行章节 loop

```text
读取 Story State
↓
分析叙事债务
↓
生成 Chapter Mission
↓
生成多个 Chapter Plan Candidates
↓
评估并选择最佳方案
↓
生成 Scene Cards
↓
逐场景写作
↓
组装 Chapter Draft
↓
Diagnostics
↓
Revision Plan
↓
Revise
↓
Final Chapter
↓
Canon Patch
↓
更新 Story State
```

CLI 示例：

```bash
novel-loop chapter my-novel 1
novel-loop chapter my-novel next
```

### 6.4 人类编辑后继续

```text
用户编辑 chapter_001/final.md 或 state/*.json
↓
运行 validate
↓
通过后继续 chapter next
```

CLI 示例：

```bash
novel-loop validate my-novel
novel-loop commit-chapter my-novel 1
```

## 7. 功能需求概览

### FR-001 项目初始化

系统必须能基于项目名和 brief 创建标准项目目录。

验收：

- 创建 `projects/<projectId>`。
- 保存 `brief.md`。
- 创建 `state/`、`planning/`、`chapters/`、`runs/`。
- 创建默认 `config.json`。
- 初始 schema 校验通过。

### FR-002 Story Bible 生成

系统必须能从 brief 生成 story bible、genre contract、reader promise 和 style guide。

验收：

- 输出 Markdown 文件。
- 包含题材、目标读者、核心卖点、世界规则、主角欲望、主角缺陷、主要冲突、叙事视角、风格禁忌。
- 不能直接生成章节正文。

### FR-003 Story State 管理

系统必须维护结构化 Story State。

必须包含：

- canon facts
- character states
- world rules
- timeline
- active threads
- narrative debts
- foreshadowing
- reader state
- relationship graph
- reveal schedule

验收：

- 所有状态文件均通过 Zod schema。
- 每次章节 commit 后生成 versioned snapshot。
- 支持 rollback 到某个 snapshot。

### FR-004 Chapter Mission Planner

系统必须在写每章前生成 Chapter Mission。

Mission 必须说明：

- 本章在全书/本卷中的功能。
- 必须推进的剧情线。
- 必须偿还或新增的叙事债务。
- 必须体现的人物状态变化。
- 读者本章应获得的信息增量。
- 禁止事项。

### FR-005 多候选章节方案

系统必须生成 N 个章节方案，并用评估器排序。

默认 N=3，配置可改。

评估维度：

- plot progression
- character arc
- tension curve
- reader curiosity
- continuity risk
- genre satisfaction
- debt management

### FR-006 场景卡生成

系统必须把选中的章节方案拆成多个 Scene Cards。

每个 Scene Card 必须包含：

- scene id
- location
- time
- POV
- entry state
- conflict
- beat list
- information delta
- character delta
- reader effect
- exit hook
- constraints

### FR-007 场景写作与章节组装

系统必须能按场景卡逐场景生成正文，并组装成章节草稿。

要求：

- 场景正文必须受 scene card 约束。
- 章节组装时处理转场、节奏和语气统一。
- 保存 `draft_v1.md`。

### FR-008 Diagnostics Engine

系统必须对草稿运行诊断。

硬检查：

- 时间线一致性。
- 人物知识一致性。
- 世界规则一致性。
- 不能提前泄露 planned reveal。
- 不能违反 chapter mission 的禁止事项。

软评分：

- plot progression
- character consistency
- tension curve
- emotional impact
- hook strength
- style match
- genre satisfaction
- reader curiosity
- prose quality

### FR-009 Revision Planner

系统必须根据 diagnostics 生成可执行修订计划。

修订策略包括：

- local_patch
- rewrite_scene
- reorder_scenes
- strengthen_hook
- reduce_exposition
- fix_character_motivation
- delay_reveal
- payoff_debt
- full_chapter_rewrite
- human_review

### FR-010 修订执行

系统必须根据 Revision Plan 修改草稿并生成新版本。

要求：

- 保存每次版本：`draft_v2.md`、`draft_v3.md` 等。
- 每次修订后重新运行 diagnostics。
- 超过最大次数仍不达标时进入 human review。

### FR-011 Canon Patch 抽取与提交

最终章节通过后，系统必须抽取 canon patch 并更新 Story State。

Canon Patch 必须包含：

- 新增事实
- 角色状态变化
- 时间线事件
- 新增/更新/关闭叙事债务
- 新增/回收伏笔
- reader state 变化
- relationship graph 变化
- reveal schedule 变化

### FR-012 Artifact 与审计日志

系统必须保存所有运行产物和日志。

每次运行必须记录：

- run id
- command
- config
- prompt input summary
- prompt output path
- token/cost metadata，如果 provider 提供
- errors
- diagnostics
- final status

## 8. 非功能需求

### NFR-001 可测试性

所有纯业务逻辑必须可单元测试。LLM 调用必须可 mock。

### NFR-002 可复现性

mock 模式下同一 fixture 必须产生相同输出。

### NFR-003 可扩展性

LLM provider、storage backend、prompt pack、genre contract 必须可替换。

### NFR-004 数据安全

默认本地存储，不向未配置的外部服务发送用户作品内容。

### NFR-005 可维护性

模块边界清晰，单文件不超过合理长度；核心类型集中管理。

### NFR-006 失败恢复

每个阶段必须 checkpoint。失败后可从最近 checkpoint 继续。

### NFR-007 人类可读

关键创作 artifacts 必须用 Markdown 保存，便于人类编辑。

## 9. v1 成功标准

1. 使用 mock LLM 能完整跑通 `init → build-bible → plan-global → chapter 1 → commit state`。
2. 章节目录中保存完整 artifacts。
3. State schema 校验通过。
4. Diagnostics 能产生硬检查和软评分。
5. Revision loop 至少能执行一次修订。
6. Canon Patch 能更新 Story State 并生成 snapshot。
7. 测试覆盖核心 schema、state update、chapter lifecycle、artifact write/read、mock loop。

## 10. v2 可选增强

- Web UI。
- 向量检索。
- 多项目 dashboard。
- 多人协作。
- 读者反馈分析。
- 角色对话一致性专项模型。
- 网文平台格式导出。
- 自动章节标题生成与 A/B 方案。
