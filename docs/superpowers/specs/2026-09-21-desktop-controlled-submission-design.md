# 桌面端检查与受控提交

状态：2026-09-21 用户已批准设计，进入实施计划审阅；不是已经开放的功能。

## 目标与范围

作者从正文工作台进入“检查并提交”，检查当前确认的正文、审阅故事变化，
再明确确认正式提交。成功后提供“创作下一章”。

保留本地 Codex、只读执行边界、schema 校验、人工确认和现有文件路径。
不新增 provider，不做历史重提交、冲突自动修复或自动采用 AI 改写。
本阶段诊断失败时展示问题并返回作者编辑，不自动进入修订循环。

## 已核实的接口差异

- `readDesktopChapterDraft` 通过 `readLatestAdoptedDraft` 优先读取作者已采用版本。
- 作者采用版本保存在 `author_revisions/`，不覆盖 `draft_v1.md`。
- 现有 `runCodexControlledCommit` 的诊断、修订计划及 final 生成仍读取
  `draft_v1.md`；预览阶段也会生成 `final.md`。
- 因此不能把该 CLI 入口直接绑定桌面“提交”，也不能暂时覆盖原稿骗过旧接口。
- 现有状态更新、冲突检测、快照和 commit journal 可以复用，但必须核查
  生命周期、项目操作锁和来源新鲜度，不能因为已有 CLI 就绕过这些检查。

## 作者流程

1. 正文工具栏保留“保存草稿”，自动保存完成后仍可主动点击。
   已持久化的同一版本只确认“已保存”，不制造空修订；保存不等于采用或提交。
2. 工作台增加“检查并提交”。若还有未采用工作副本，先提示采用或放弃修改。
3. 确认检查后开始任务：核对正文 → 检查一致性 → 整理故事变化 → 校验变化。
   显示阶段、耗时、停止入口。取消只在安全阶段边界生效。
4. 检查不通过时显示中文问题、短证据和“返回修改”。正式提交按钮不可用。
5. 通过后展示本次将提交的正文版本及故事变化：事实、人物、时间线、悬念、
   伏笔、读者信息与关系。高风险变化突出显示，不向普通作者显示 JSON 路径。
6. 用户勾选确认审阅后点击“正式提交第 N 章”，再次确认。此步不再调用 Codex。
7. 成功显示“第 N 章已正式提交”，刷新项目数据；存在下一章规划时可点击
   “创作下一章”。规划耗尽时返回全局规划，不伪造下一章。

## 来源绑定与安全规则

- 捕获当前桌面选中的正文（优先最新已采用版本）的路径、revision 身份和 SHA-256。
  后端确定路径；renderer 只能传 projectKey 和不透明 token。
- 将精确正文保存为隔离的版本化提交候选，不进行二次润色、场景重组或替换标题。
- 同时绑定 Story State、queue、mission、selected plan、config 阈值的哈希。
- 诊断与 patch 提案都使用这份正文及同一份上下文；采用既有 hard checks 和
  qualityGate，不降低门槛。LLM 只能返回结构化提案，不能写正式状态。
- 确认前在项目排他锁内再次校验全部哈希、最新采用版本、工作副本状态、
  schema、conflict checks、章节顺序及 journal 状态。
- 任何改动或未采用工作副本使预览失效。提示重新检查，不自动重新生成后提交。
- 只允许 `latestCommittedChapter + 1`。已提交章节和历史章节不得从此入口重提。
- 确认 token 有有效期、项目和章节绑定；成功后单次消费。并发点击只提交一次。
- 检查阶段不写 Story State、正式 final/patch、commit report 或 commit snapshots；
  不用 canonical queue 冒充任务进度，任务状态由独立服务维护。
- 确认阶段将已审阅正文复制为正式 final，接受经验证的 patch，再由本地引擎
  执行 before snapshot → apply → after snapshot → report → queue 更新。
  每个持久化阶段记 journal，具体顺序与已有 journal 合约保持兼容。
- 多文件提交不宣称原子事务。任何中途失败保留 journal 与 provenance，禁用
  重复提交并显示恢复待检查；不进行未经授权的自动回滚或自动恢复。

## API 边界

Renderer → typed preload API → main application service → desktop engine facade。

拟增加独立 `submission` API，而不是扩充泛化文件或执行命令接口：

- `startCheck({ projectKey })`：返回不透明 taskId。
- `get({ taskId })`：返回阶段、状态、作者可读问题和安全错误种类。
- `cancel({ taskId })`：请求在下个安全边界停止，不终止已开始的本地提交事务。
- `readPreview({ projectKey })`：返回脱敏摘要、正文版本、来源是否过期及 previewToken。
- `confirm({ projectKey, previewToken, confirm: true })`：受控本地提交。

所有请求与返回都以严格 Zod schema 校验，并验证可信 renderer sender。
main 解析已登记项目，禁止任意路径、命令、provider 参数或 patch 数据从 renderer 输入。
恢复和刷新读取持久化 manifest 后重新验证来源，不信任内存里的旧成功状态。

## Schemas 与隔离 artifacts

实现前在 `src/schemas/` 定义并加入 artifact registry / strict audit：

- `DesktopSubmissionPreviewSchema`：projectId、chapterNumber、来源身份与 hashes、
  diagnostics/patch/conflict/diff 引用与哈希、gate 结果、createdAt、版本号。
- `DesktopSubmissionApprovalSchema`：预览身份、批准的 source/patch/diff hashes、
  approvedAt、明确确认信息；不得由检查阶段自动生成。
- `DesktopSubmissionTaskSchema`：检查阶段、状态、错误、停止状态、关联 run；
  与 renderer 的脱敏 task 合约分开，日志不包含凭证。

拟使用 `chapters/chapter_NNN/submission_previews/preview_vN/` 存放：
source.md、diagnostics.json、patch_proposal.json、normalized_patch.json、
conflict_report.json、state_diff.json、manifest.json。
除 manifest/task/approval 新 schema 外，优先复用已有对应 artifact schema。
失败记录与有效预览分离；每次新检查新版本，不覆盖原稿、作者修订或以前报告。
确认后继续使用现有 canonical final、canon_patch、commit_report 和 snapshots 路径。

## 涉及模块

- `src/desktop/`：新增提交 facade，解析真实桌面正文来源和控制读写权限。
- `src/app/`：优先复用诊断上下文、schema/parser、qualityGate、patch/diff、
  项目操作锁、journal、snapshot、queue；不得盲目调用旧的整段 CLI pipeline。
- `apps/desktop/src/main/`：提交任务服务、opaque token 与 sender 校验。
- `apps/desktop/src/shared/`、`preload/`：窄类型化 API 与严格 contract。
- renderer：检查进度、问题审阅、故事变化预览、确认与成功界面；保留正文工作台。

## 验收门槛

- 作者修订与原稿故意不同，fake Codex 实际收到的是作者采用版本。
- 确认后 final 与审阅正文逐字节一致，绝不静默回退原稿。
- 检查、取消、diagnostics fail、schema fail、conflict fail 均不污染正式状态。
- 编辑/采用新版本、外部文件变化、阈值变化、过期 token 均阻断旧预览提交。
- 双击、并发窗口、重复请求不产生第二次状态推进。
- 提交各持久化阶段故障注入可检测；不完整 journal 不显示“成功”或自动再提交。
- 检查和恢复入口均可重启使用；恢复不自动调用 provider。
- strict audit / validate 通过；mock 三章、fake Codex、作者编辑流程不回归。
- Electron E2E：保存 → 采用 → 检查 → 审阅 → 确认 → 成功 → 下一章。
- 所有测试只用临时项目和 fake Codex。真实用户项目只在用户亲自确认时提交。

## 实施闸门

此项新增正式状态写入能力，属于独立的提交子系统，不是单按钮修复。
先批准本设计，再编写分步实现计划和失败注入测试；在受控提交与状态保护测试
通过前不开放“正式提交”操作，也不显示不可执行的假入口。
