# Desktop Controlled Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者从已采用正文进入检查、审阅故事变化、明确确认本地提交，成功后进入下一章；保存和采用修订本身绝不提交。

**Architecture:** 独立的 desktop submission facade 绑定精确正文及上下文，隔离生成预览；main 管理任务、工作副本互斥与不透明确认凭证。确认阶段不调用模型，在项目锁内复核来源并通过既有 patch、snapshot、journal 和 queue 机制提交。不能直接调用会读取 draft_v1、在预览阶段写 final 的旧 CLI 整体流程。

**Tech Stack:** TypeScript、Zod、现有 Node.js Engine/FileStore、Electron typed preload、React、Vitest、Playwright、fake Codex；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-controlled-submission-design.md`（用户已批准）。

## Global Constraints

- 保留本地 Codex、只读执行边界、schema 校验、人工确认和现有文件路径。
- 不新增 provider，不做历史重提交、冲突自动修复或自动采用 AI 改写。
- 本阶段诊断失败时展示问题并返回作者编辑，不自动进入修订循环。
- 确认后 final 与审阅正文逐字节一致，绝不静默回退原稿。
- 所有请求与返回都以严格 Zod schema 校验，并验证可信 renderer sender。
- 所有测试只用临时项目和 fake Codex。真实用户项目只在用户亲自确认时提交。
- 保留当前工作区已有修复；不顺带提交、暂存或清理其他改动，不清理真实 projects。
- 正式提交入口只在整个安全链通过测试后开放；中间任务完成不代表功能已交付。

## Review Focus

1. 作者采用后又有未保存/未采用修改，或另一个窗口保存：旧预览不得提交（任务 4、6）。
2. 预览目录、源文件被替换成 symlink，或文件内容被外部编辑：拒绝越界与陈旧内容，不静默修复（任务 2、3）。
3. state 写成功但报告/queue 写失败，或进程在 journal 更新前退出：显示待检查，绝不重新 apply（任务 3、7）。
4. 重启、重复确认、两个窗口同时确认：只推进一次，旧 token 不自动恢复授权（任务 3、4、7）。
5. 规划已耗尽、已提交的下一章入口、检查任务取消/额度不足：保留原文，明确下一步，不创建假章节（任务 2、6、7）。

## 已核实的复用边界

- `src/desktop/chapterWorkspace.ts` / `src/app/chapterAuthorRevision.ts` 已优先读取采用版；复用相同来源规则。
- `src/app/codexControlledCommit.ts` 的旧整体流程不适用。仅提取必要的无持久化辅助函数，现有 CLI 行为不改。
- `src/app/projectOperationLease.ts` 同项目嵌套调用复用 AsyncLocalStorage lease；不同章节拒绝嵌套。不能通过嵌套调用升级只读 lease 为写状态权限。
- `src/app/stateDiff.ts` 当前 diff writer 写项目级 diffs；增加指定隔离输出的窄参数或提取纯 diff builder，保留现有默认行为。
- `src/schemas/commitReport.ts` 定义 journal 类型与阶段；新增 desktop 类型/阶段必须向后兼容，不能篡改历史 journal。
- `src/app/artifactIndex.ts` 按路径分类，`src/app/projectAudit.ts` 校验 artifacts；新目录必须显式注册，不能只写 JSON 后跳过 audit。
- `apps/desktop/src/main/chapter/DraftWorkingCopyStore.ts` 的工作副本在应用数据目录；项目 lease 不自动保护它，main 必须共享互斥，不能仅检查 renderer 的 dirty 标志。

## 文件分工

新建引擎文件：`src/schemas/desktopSubmission.ts`（持久化合约）、`src/desktop/chapterSubmission.ts`（公开 facade）、`src/app/desktopSubmissionSource.ts`（来源和 freshness）、`src/app/desktopSubmissionPreview.ts`（隔离检查）、`src/app/desktopSubmissionCommit.ts`（本地提交）、`src/app/desktopSubmissionAudit.ts`（审计交叉引用）。

新建桌面文件：`apps/desktop/src/shared/submissionContract.ts`、`src/main/submission/EngineSubmissionGateway.ts`、`ProjectSubmissionService.ts`、`SubmissionTokenStore.ts`、`ProjectSubmissionGuard.ts`（后三者同目录）、`src/main/ipc/registerSubmissionHandlers.ts`、`src/renderer/src/features/submission/ChapterSubmissionView.tsx`、`SubmissionChanges.tsx`（同目录）。桌面路径均以 `apps/desktop/` 为前缀。

现有章节服务不做整体拆分；只注入共享 guard 和工作副本检查入口。API 注册、App 路由、正文按钮、文案、少量样式和 README 随对应任务修改。

## Task 1: Schemas、合约与测试样本

验收状态：已完成；63 项定向测试和类型检查通过，独立规格/质量审查通过。尚不代表提交功能已开放。

**Files:** 新建 `src/schemas/desktopSubmission.ts`、`tests/unit/desktopSubmissionSchemas.test.ts`、`tests/helpers/desktopSubmissionFixture.ts`；修改 `src/schemas/index.ts`。新建 `apps/desktop/src/shared/submissionContract.ts`、`apps/desktop/tests/shared/submissionContract.test.ts`。

**Interfaces:** 所有持久化类型由 Zod 推导，导出 `DesktopSubmissionPreview`、`DesktopSubmissionApproval`、`DesktopSubmissionTask`、`DesktopSubmissionSource`。`DesktopSubmissionSource` 绑定 projectId/chapterNumber、sourcePath/hash、revisionId（generated 时 null）、state/queue/mission/selectedPlan/config 的路径与 SHA-256。所有路径为受约束相对路径，运行时仍检查文件真实位置。

Preview 包含 schemaVersion=1、previewId/version、source、createdAt、runId、diagnostics/patch/conflict/diff 引用与 hashes、gatePassed；Task 包含 taskId、projectId、chapterNumber、stage、status、runId、previewId、startedAt/endedAt、safeErrorCode。Approval 包含 approvalId、previewId、projectId/chapterNumber、source/manifest/patch/diff hashes、confirmed=true、approvedAt、runId；不存明文 token。

阶段：`checking_source | diagnostics | proposing_patch | validating_patch`；任务状态：`running | cancel_requested | cancelled | failed | blocked | ready | interrupted`。Preview 只在所有 artifacts 校验完后发布；失败保存 task/run，不发布可确认预览。

- [x] 先写 schema valid/invalid fixture 测试：hash 非法、路径逃逸、负章节、approval false、ready 缺 previewId、unknown 字段全部拒绝。

```ts
expect(DesktopSubmissionApprovalSchema.safeParse({ ...validApproval, confirmed: false }).success).toBe(false);
expect(DesktopSubmissionPreviewSchema.safeParse({ ...validPreview, extra: true }).success).toBe(false);
```

- [x] 执行 `corepack pnpm exec vitest run tests/unit/desktopSubmissionSchemas.test.ts`，确认先因未实现失败，再实现 strict schema 和 cross-field refine，运行至通过。
- [x] 定义 IPC 请求：startCheck/readPreview 只允许 `{projectKey}`；get/cancel 只允许 `{taskId}`；confirm 只允许 `{projectKey,previewToken,confirm:true}`。拒绝任意 path、provider、patch、command 字段。

```ts
export const SubmissionConfirmRequestSchema = z.object({
  projectKey: z.string().min(1).max(128),
  previewToken: z.string().regex(/^submission_[a-f0-9]{48}$/u),
  confirm: z.literal(true)
}).strict();
```

- [x] 定义脱敏返回 `SubmissionTask`、`SubmissionPreviewResult`、`SubmissionConfirmResult`。Preview 用 outcome=`ready|not_ready|stale|blocked` 区分，ready 含 previewToken、chapterNumber、正文版本/摘要、自然语言 changes 和 warnings；confirm 用 outcome=`committed|stale|busy|blocked|recovery_required`，成功含 chapterNumber/latestCommittedChapter/hasNextChapter。
- [x] fixture 使用临时项目初始化/规划与已有 fake Codex；生成原稿 A、采用稿 B，B 增加唯一标识文本。helper 返回项目路径与清理函数；不读取或复制用户项目。
- [x] 跑 schema/contract 测试，记录结果并人工检查 diff；暂不把 API 暴露给 renderer。

## Task 2: 精确来源与隔离检查

验收状态：已完成；精确采用版、隔离写入、source freshness、schema 与特殊文件保护已通过定向测试及独立复核。

**Files:** 新建 `src/app/desktopSubmissionSource.ts`、`desktopSubmissionPreview.ts`、`src/desktop/chapterSubmission.ts`、`tests/integration/desktopSubmissionPreview.test.ts`。修改 `src/desktop/index.ts`、必要时 `src/app/stateDiff.ts`、`tests/helpers/fakeCodex.ts`。

**Interfaces:** facade 定义 `SubmissionProjectInput={projectRoot:string,chapterNumber:number}`；`SubmissionCheckInput` 扩展该类型加 `taskId:string`。导出 `checkDesktopChapterSubmission(input, options):Promise<DesktopSubmissionTask>` 与 `readDesktopSubmissionPreview(input):Promise<DesktopSubmissionPreview|null>`。options 是 main 内部注入的 `{fileStore?:FileStore, client:LLMClient, shouldCancel:()=>boolean, onProgress:(task:DesktopSubmissionTask)=>Promise<void>}`，不来自 IPC。source 模块导出 `captureSubmissionSource(input,fileStore):Promise<DesktopSubmissionSource>`、`assertSubmissionSourceFresh(source,projectRoot,fileStore):Promise<void>`。

- [x] 先测试 adopted B 被实际传给 diagnostics 与 patch prompt，原稿 A 未被替换。记录 state/queue/draft_v1/author revisions 的 bytes，检查后全部一致；final/patch/report/snapshot 不存在。

```ts
expect(recordedDiagnosticsPrompt).toContain(adoptedText);
expect(await fileStore.readText(paths.chapterArtifact(1, 'draft_v1.md'))).toBe(originalText);
expect(await fileStore.exists(paths.chapterArtifact(1, 'final.md'))).toBe(false);
```

- [x] 执行 `corepack pnpm exec vitest run tests/integration/desktopSubmissionPreview.test.ts`，确认失败后实现 source capture。已有采用版读取失败必须报错，不能 fallback 到原稿；只在确实没有采用记录时读取 generated draft。
- [x] 在只读 state lease 内捕获和复核来源；安全分配 preview_vN，检查每个路径不存在逃逸/symlink 替换；不覆盖旧版本。source.md 保持原始字节，不做标题改写。
- [x] 使用现有 diagnostics context builder、PromptService、LLMClient、parser、schema 和 qualityGate；收到 blocked 立即结束，不调用 patch、不自动改稿。
- [x] patch 提案经过规范化、CanonPatchSchema、冲突检查及试 apply 的 StoryStateSchema。写隔离 conflict/diff；按 schema 写 manifest 最后发布 ready。所有调用进入 RunLogger/promptCalls，日志不包含凭证。
- [x] 每次 provider 阶段结束与预览发布前检查 cancel/freshness；取消时保存 provenance，不发布 ready。超时、额度不足、JSON invalid 分类沿用既有 provider，不加无限重试。
- [x] 增加 mission/config/state 变化、adopted 缺失/损坏、symlink、hard fail、schema fail、conflict、取消、规划耗尽用例。运行该文件及 `tests/unit/desktopChapterWorkspace.test.ts` 至通过。

## Task 3: 本地确认与失败安全

验收状态：已完成；41 项定向测试及 110 个持久化边界故障场景通过，独立复核通过。仅使用临时项目，未提交真实小说。

**Files:** 新建 `src/app/desktopSubmissionCommit.ts`、`tests/integration/desktopSubmissionCommit.test.ts`、`tests/integration/desktopSubmissionCommitFailures.test.ts`；修改 facade、`src/schemas/commitReport.ts`、必要时 `src/app/commitJournal.ts`。复用 `chapterCommit.ts`、`chapterQueue.ts`、`SnapshotStore.ts`。

**Interfaces:** facade 导出 `confirmDesktopChapterSubmission(input):Promise<{chapterNumber:number;latestCommittedChapter:number;commitReportPath:string;hasNextChapter:boolean}>`。input 扩展 SubmissionProjectInput 加 `previewId:string,expectedManifestHash:string,approvalId:string,confirm:true`，由可信 main 构造；生产调用不接受 FileStore/provider 参数。底层服务允许通过单元测试依赖注入故障 FileStore，不通过 IPC 暴露。

- [x] 先测试提交 final 的 Buffer 与 source.md/adopted B 完全一致；确认调用 provider 计数为 0；只推进一章，保留 A/B 和预览文件。

```ts
expect(await readFile(paths.chapterArtifact(1, 'final.md'))).toEqual(Buffer.from(adoptedText));
expect(providerCallsAfterConfirm).toBe(providerCallsBeforeConfirm);
expect(committedState.latestCommittedChapter).toBe(1);
```

- [x] 跑 `corepack pnpm exec vitest run tests/integration/desktopSubmissionCommit.test.ts` 得到红灯后，在写 state 许可的项目 lease 内核对下一章、journal、全部来源和预览 artifacts 的 schema/hash、gate 与冲突。预计算完整新 state 并校验，任何失败不能开始 canonical 写入。
- [x] journal 增加 `desktop_controlled_commit` 类型及必要的 canonical final phase。持久化顺序：prepared journal → approval → reviewed final → normalized canonical patch → before snapshot → state write → after snapshot → state mutation/run provenance → commit report → queue committed → completed journal。
- [x] 每一阶段按既有 FileStore atomic write+phase 记录；queue 通过合法 FSM，不直接塞 status，预览不能借用 queue 表达进度。检测到现有 canonical 文件但无法证明同次已完成提交时拒绝覆盖。
- [x] 注入每一个持久化操作前/后异常；尤其 state 成功、journal 记录失败，要求 journal incomplete/failed 可检测，后续调用拒绝再次 apply。不得把异常写失败本身吞成 success。
- [x] 并发两个 facade 确认同一 preview：一个推进一次，另一个返回受控已提交/阻断；不同 preview、已提交章节、历史章节一律拒绝。
- [x] 运行两个新 integration 文件与 `tests/e2e/codexControlledCommitConfirm.test.ts`、`codexControlledCommitFailure.test.ts`、`codexControlledCommitSafety.test.ts`；不改变旧 CLI 默认行为。

## Task 4: Main 任务、凭证与工作副本互斥

验收状态：已完成；386 项桌面定向测试和 16 项诊断证据读取测试通过。独立复核另跑 48+16 项通过，下一章恢复、失败证据和长篇读者信息问题已修复。

进度：独立凭证、共享 guard、服务接入和工作副本保护均已完成并通过独立审查。

**Files:** 新建 main/submission 下四个文件（见文件分工）；修改 `apps/desktop/src/main/chapter/ProjectChapterService.ts`、`src/main/index.ts`。新增 `apps/desktop/tests/main/projectSubmissionService.test.ts`、`submissionTokenStore.test.ts`。

**Interfaces:** `EngineSubmissionGateway` 只包装任务 2/3 facade。`ProjectSubmissionService` 方法为 `startCheck/get/cancel/readPreview/confirm`，请求/结果采用任务 1 contract。`ProjectSubmissionGuard.runExclusive<T>(projectKey:string,operation:()=>Promise<T>):Promise<T>` 在 main 服务中共享，保护工作副本保存/放弃/采用与提交准入；不把长 provider 任务占用整个 editor guard。

- [x] 测试存在持久化未采用副本时 startCheck/confirm blocked；renderer 未落盘 dirty 在任务 6 阻断。新检查启动与确认检查均读取真实 workingCopyStore，不信任前端传来的 saved。
- [x] main guard 内绑定来源/工作副本身份，确认期间禁止同项目 save/adopt/discard 改变来源；跨进程 canonical 写入仍依赖 engine lease。长检查允许后续编辑，但使结果 stale，不能死锁保存。
- [x] token 采用 24 随机字节，TTL 30 分钟、最多 200 个绑定，绑定 projectKey/real root/chapter/previewId/manifestHash。reserve → apply → consume；开始持久化后失败作废 token，必须显示 recovery_required。

```ts
expect(await service.confirm({projectKey: otherProjectKey, previewToken, confirm: true}))
  .toMatchObject({outcome: 'stale'});
expect(commitGatewayCallCount).toBe(0);
```

- [x] 重启 readPreview 重新读取 schema/hash/source，生成新的 token；绝不从磁盘恢复旧授权。running task 重启变 interrupted，只读展示，不自动重启模型；完成 journal 用于判定上次确认是否完成。
- [x] 测试双击、跨窗口、到期、项目目录改变、恢复后的 dirty 副本、失败日志脱敏、取消和磁盘写入错误。可复用已完成结果给同请求 UI，但不得第二次写 state。
- [x] 跑 `corepack pnpm --dir apps/desktop exec vitest run tests/main/projectSubmissionService.test.ts tests/main/submissionTokenStore.test.ts tests/main/projectChapterService.test.ts`；检查未引入未经 schema 校验的持久化 token JSON。

## Task 5: IPC 与审计接入

验收状态：已完成；IPC 392 项定向测试、审计 109 项用例及独立复核通过。整体交付仍待任务 6/7。

**Files:** 新建 `apps/desktop/src/main/ipc/registerSubmissionHandlers.ts`、`apps/desktop/tests/main/submissionHandlers.test.ts`；修改 shared/desktopApi.ts、shared/ipcChannels.ts、preload/index.ts、main/index.ts、`tests/preload/preloadBoundary.test.ts`。新建 `src/app/desktopSubmissionAudit.ts`、`tests/integration/desktopSubmissionAudit.test.ts`；修改 `src/app/artifactIndex.ts`、`src/app/projectAudit.ts`、`src/schemas/observability.ts`。

- [x] 为五个 submission IPC channel 写拒绝非可信 sender/iframe、额外字段、跨项目 token 的失败测试；preload 精确白名单增加 submission，不暴露 ipcRenderer 或 Node。

```ts
expect(SubmissionConfirmRequestSchema.safeParse({
  projectKey, previewToken, confirm: true, patch: {}
}).success).toBe(false);
```

- [x] 暴露 typed preload API，逐请求/结果 parse；错误只返回安全 messageKey，不把路径、prompt 或 raw error 传给作者 UI。更新现有严格 mock API fixtures，不放宽成 unknown/any。
- [x] 增加 artifact 类型 `desktop_submission_preview|desktop_submission_task|desktop_submission_approval`。隔离目录内 diagnostics、patch、conflict、diff 按已有 schema 分类，不误认为 canonical final；source.md 为预览来源类型。
- [x] audit 验证 manifest 引用、hash、approval 与 journal 对应关系、完成提交 final/patch 与批准版本一致。历史预览 source state 与 live state 不同只能标记过期，不因正常后续提交而误报损坏；篡改预览内部文件仍报 error。
- [x] 测试缺文件、schema invalid、hash mismatch、incomplete journal、已提交后旧预览仍可审计。执行两端定向测试及 `corepack pnpm build`、desktop check；strict audit 的回归用临时完整项目。

## Task 6: 作者检查、审阅和提交界面

验收状态：独立提交组件 34 项测试及复核通过；正文入口和页面跳转的 96 项回归及独立复核通过，5 项专项 Electron 用例通过。最终全量 Electron 门槛见任务 7。

**Files:** 新建 features/submission 两个组件（见分工）、`apps/desktop/tests/renderer/chapterSubmission.test.tsx`。修改 App.tsx、features/chapter/ChapterWorkspace.tsx、ChapterDraftEditor.tsx、i18n/messages.zh-CN.ts、styles/chapter.css、tests/renderer/desktopApiFixtures.ts、chapterDraftEditor.test.tsx、chapterWorkspace.test.tsx、App.test.tsx。

**Interfaces:** `ChapterSubmissionView({projectKey,onBack,onCommitted})`，onCommitted 接收成功返回的 chapterNumber/hasNextChapter，父组件刷新 project overview。`SubmissionChanges({changes})` 只渲染 schema 验证过的作者摘要。ChapterDraftEditor 新增 `onCheckSubmission:()=>void`，只在无 dirty、无 pending adoption、无保存/采用操作时调用。

- [x] 先写交互测试：自动保存后“保存草稿”仍可点、不生成空 revision；采用成功进入预览，显示尚未正式提交；“检查并提交”可见。存在未采用修改时说明先采用或放弃，不显示错误的“先保存”提示。

```tsx
expect(screen.getByRole('button', {name: '保存草稿'})).toBeEnabled();
expect(screen.getByRole('button', {name: '检查并提交'})).toBeEnabled();
expect(screen.queryByRole('button', {name: /正式提交第/})).not.toBeInTheDocument();
```

- [x] 添加显式开始检查确认、阶段/耗时、取消请求、诊断问题/短证据/返回修改、故事变化分类、高风险提示。调用失败保留原稿和安全恢复入口，不无限自动 retry。
- [x] ready 后显示正文版本与全部 state changes；用户勾选审阅确认，点击“正式提交第 N 章”打开确认 dialog，再调用 confirm。无 Enter 默认危险动作；loading 禁用重复请求但服务端仍独立幂等。
- [x] stale 提示“正文或故事档案已变化，请重新检查”；incomplete journal 提示“提交中断，需要检查”，禁用再次提交；不引导再次采用正文来掩盖提交错误。
- [x] 成功后显示“第 N 章已正式提交”；有规划进入现有下一章确认流程，无规划显示返回全局规划。成功后 overview 不再停留当前已提交 draft。
- [x] 增加键盘焦点恢复、取消/失败 aria-live、确认对话框焦点约束；布局沿用现有组件，不重做产品视觉。
- [x] 运行上述 renderer 测试与 desktop check。交付前截图验证 1440×900 与 1024×768：按钮不被长文推离操作区、不重叠，长 changes 可滚动，桌面保持原生 Electron 流程。

## Task 7: 端到端状态保护与交付

验收状态：已完成。引擎全套 205 文件/902 测试、桌面全套 44 文件/917 测试通过；最终发布关联修复另跑 220 项受影响测试，独立复核再跑 33 项通过。修复后重新构建、桌面完整类型检查和 required Electron 14 项全部通过，无跳过。故障注入和响应丢失保护在 engine/main/component 层验证，Electron 覆盖真实窗口正常提交、重启、失败、取消与 stale；不声称做过操作系统掉电模拟。

**Files:** 修改 `apps/desktop/tests/e2e/electron-smoke.test.ts`、`apps/desktop/README.md`；按验证结果更新本计划复选框，不修改真实项目 artifacts。

- [x] 新增 Electron fake Codex 全链：临时项目 → 生成 → 修改正文 → 手动/自动保存 → 采用 B → 检查 B → 审阅 → 确认 → latest=1 → 创建下一章入口。断言原稿 A 不变、final=B、queue committed、snapshot/journal/report 存在、validate/audit 通过。
- [x] 重启检查恢复不调用 provider；在确认成功响应丢失、应用重启后，界面读取完成记录而不是再次提交。插入 partial-write 故障用例，证明再次确认被拦截。
- [x] 加入 fake hard fail/额度不足/取消/新采用版本导致 stale、修改新副本时不可提交的 E2E；不得为了使 E2E 通过降低 gate。
- [x] 顺序运行，避免并行耗尽本机资源：

```bash
corepack pnpm build
corepack pnpm check
corepack pnpm --dir apps/desktop check
corepack pnpm test
corepack pnpm --dir apps/desktop test
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop test:e2e:required
git diff --check
```

- [x] root suite 必须包含 `multiChapterProgression`、fake Codex controlled commit/preview/safety；没有真实 Codex 环境不是跳过 fake 测试的理由。不运行真实用户项目 demo/clean。
- [x] README 区分“已保存”“已采用”“已正式提交”，标明提交位置和失败后处理；声明诊断失败人工编辑、journal 只检测不自动恢复。保存 screenshot/测试摘要到忽略的 test-results，不添加凭证或真实小说。
- [x] 完成独立安全审阅：精确版本绑定、workspace-write 仍禁用、confirm 零 provider、partial failure 不重复 apply、IPC 权限边界。修复后重跑相关测试再报告。
- [x] 最后给出启动命令 `corepack pnpm desktop:dev`、作者点击流程和实际验证结果。只有全部通过才说明桌面正式提交已可用；不自动提交 git，先展示本次文件范围。

## 停止 / 回滚规则

- schema、journal 或现有 mock/fake Codex 回归失败时不开放 renderer 入口；修复本次代码，不重置用户工作区。
- 检查失败或取消只留下版本化任务/日志，原文和 canonical 状态不变，无需删除 artifacts。
- local commit 中断后保留 before snapshot 和 journal，阻断写操作；人工检查前不自动回滚或继续 apply。
- UI 回退时仅撤销本功能导航和 API 接入，不删除已生成的审计记录，不批量撤销此前保存/采用修复。

## 计划自检与执行闸门

- 设计来源/隔离/只读检查：任务 1、2；本地确认/失败检测：任务 3；一次性凭证/工作副本：任务 4。
- typed API、artifact schema/audit：任务 5；作者流程/可访问性：任务 6；重启、完整回归/文档：任务 7。
- Review Focus 五类失败模式均已落到明确任务。没有把旧 CLI 的 final 写入行为带入预览，也没有承诺多文件提交原子性。
- 用户选择 Subagent-driven 后，本计划已实施并通过逐任务及最终独立审查。桌面提交入口已接通；验证范围和未覆盖的真实 Codex/打包验收见配套验证报告。未自动提交 Git 或真实小说。
