# Novel Loop

以故事档案（Story State）为核心、由本机 Codex CLI 辅助的本地优先长篇小说创作工具。

仓库包含 **Electron 桌面应用**和 **Novel Loop Engine 命令行引擎**。作者在桌面中组织小说、选择章节方向、编辑正文、检查一致性，并明确确认哪些变化写入正式故事档案。AI 生成不等于正式提交。

> 当前是源码运行的桌面开发版本，不是已经打包发布的正式安装版。引擎包版本仍为 `2.5.0-rc.1`，桌面包版本为 `0.1.0`；历史 RC 文档描述的是当时的 CLI 基线，不代表后续桌面功能都已达到生产发布标准。

## 文档导航

- [本地启动](#本地启动)
- [作者使用流程](#作者使用流程)
- [数据与安全边界](#数据与安全边界)
- [开发与验证](#开发与验证)
- [桌面应用详细说明](apps/desktop/README.md)
- [本次受控提交验证记录](docs/superpowers/reports/2026-09-21-desktop-controlled-submission-verification.md)
- [Codex pilot 操作手册](docs/operations/codex-pilot-runbook.md)
- [历史 RC checkpoint](docs/releases/v2.5.0-rc.1-release-checkpoint.md)
- [不需要 API key 的 Mock Demo](#quickstart-mock-demo)

## 当前能力

| 模块 | 当前支持 |
| --- | --- |
| 环境与项目 | Codex 可用性检查、本地作品库、新建或打开项目 |
| 故事准备 | 生成并阅读故事基础、全书及分卷规划 |
| 章节方向 | 比较候选、选择非默认方案、编辑章节任务和方向、修复出场人物 |
| 正文创作 | 场景生成、初稿、手动保存与自动保存、工作副本恢复、对比并采用作者修订 |
| 检查与提交 | 检查已采用正文、展示问题和证据、审阅故事变化、二次确认后本地提交 |
| 状态保护 | 来源哈希校验、过期预览阻断、一次性确认凭证、快照、提交日志、审计 |
| 后续章节 | 提交成功后进入已有下一章规划流程；规划耗尽则返回规划 |
| 引擎工具 | Mock 三章闭环、运行记录、artifact 索引、快照浏览、回滚及实验性 Codex 工具 |

桌面上的故事基础和全局规划目前是生成后的只读审阅界面，尚不支持逐项编辑。诊断失败后由作者修改，不自动改写或采用新正文。CLI 支持的所有内部命令并不等于桌面已开放对应功能。

## 本地启动

### 环境要求

- 首版目标系统：Ubuntu 24.04。Windows 和 macOS 尚未作为本轮桌面验收平台。
- 桌面构建：Node.js `20.19+` 或 `22.12+`，与当前 Vite 依赖要求一致；仅使用 CLI 的最低要求是 Node.js 20。
- pnpm `10.12.1`，可通过 Corepack 使用。
- AI 生成需要预先安装并登录的本机 Codex CLI。应用不替你管理安装、更新、认证或使用额度。
- Linux 需要可用的 Chromium 安全沙箱和图形桌面环境。

### 克隆与运行

需要已配置 GitHub SSH 访问权限。当前桌面开发分支为 `codex/novel-loop-desktop-prototype`：

```bash
git clone --branch codex/novel-loop-desktop-prototype git@github.com:MrMO0802/Novel-Loop.git
cd Novel-Loop
corepack enable
corepack prepare pnpm@10.12.1 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm desktop:dev
```

如果系统没有 `corepack`，先为当前 Node.js 环境安装 Corepack，或直接使用 pnpm `10.12.1`。已可用时不必重复执行 `corepack enable`。首次安装请允许仓库配置的 Electron/esbuild 依赖构建，否则 Electron 二进制可能不可用。

命令会构建本地引擎并打开 **Novel Loop 桌面窗口**。终端显示的 `http://127.0.0.1:5173/` 是开发用 renderer 服务，不是让作者在浏览器中使用的产品入口。

仅构建桌面应用：

```bash
corepack pnpm desktop:build
```

该命令生成 Electron 构建目录，不生成 `.deb`、AppImage 或 Windows 安装包。更新源码后，请停止原启动进程并重新运行 `desktop:dev`，确保 main 和 preload 也加载新版本。

## 作者使用流程

1. 完成环境检查，进入作品库并创建小说项目。
2. 输入创意，明确开始生成故事基础；阅读后继续生成全局规划。
3. 创建下一章，比较章节方向，按需调整任务、人物和方案，再确认生成初稿。
4. 阅读和编辑正文。自动保存或点击“保存草稿”保存工作副本。
5. 对比修改并“采用此修订”。采用后切换到正文预览，但还没有正式提交。
6. 点击“检查并提交”，再点击“开始检查”。等待一致性检查和故事变化提案。
7. 如果检查失败，可返回人工修改，或点击“让 AI 根据检查结果修订”并明确开始生成独立候选。对比后采用或拒绝；采用后必须重新检查。若通过，审阅全部故事变化与高风险提示。
8. 勾选“我已审阅正文版本和全部故事变化”，点击“正式提交第 N 章”，在弹窗中再次确认。
9. 提交成功后，点击“创作下一章”。不会自动开始新的 AI 生成任务。

| 显示状态 | 含义 |
| --- | --- |
| 已保存 / 已自动保存 | 工作副本已落盘；不代表采用或提交 |
| 已采用 | 当前作者修订被选中；原始 `draft_v1.md` 和正式故事档案不变 |
| 检查完成 | 生成了可审阅的独立预览；正式故事档案仍不变 |
| 已正式提交 | 本地引擎已应用批准的变化并推进章节状态 |

自动保存后仍可以主动点击“保存草稿”，相同内容不会制造重复修订。有未采用修改时，先采用或放弃修改才能提交。正文或故事档案变化会使旧预览失效，必须重新检查和审阅。

AI 修订候选保存在章节的 `diagnostic_revisions/revision_vN/`，不会自动覆盖原稿或正式提交。候选生成会向现有 Codex 服务发送已检查正文、问题和相关故事上下文；只有作者点击生成才启动调用。当前支持整份候选采用或拒绝，不支持逐段自动采用，也不保证一次修订就通过检查。过期诊断需重新检查；取消或失败保留原稿。采用过程出现无法核实的中断时会阻断重试，不会静默新增版本。

## 数据与安全边界

```text
React renderer
  -> typed preload API
  -> Electron main / application service
  -> Novel Loop Engine
  -> local files / read-only Codex execution boundary
```

- 项目目录由作者选择。作品库登记信息和未采用工作副本保存在 Electron 应用数据目录。
- 原稿和作者修订保留。确认后的 `final.md` 与审阅正文逐字节一致，不静默换回原稿。
- 检查阶段不写正式 final、canonical patch、Story State 或 commit snapshots，也不用章节队列冒充检查任务进度。
- 正式确认不再调用 Codex；本地引擎重新检查来源、schema 和冲突后，通过 Canon Patch 更新状态。
- Codex 默认 `read-only`，不开放 workspace-write；renderer 不直接读写项目文件、不执行 shell、不接触 token 或认证文件。
- 多文件提交不是原子事务。中断后保留 journal、快照和证据，阻断重复提交；**不自动恢复、回滚或清除异常记录**。
- 快照用于状态追溯，不是整个项目的完整备份。重要项目仍应另外备份项目目录及所需的应用数据。

**本地优先不等于 AI 离线运行。** 本机 Codex 可能把当前任务所选的小说正文和上下文发送给其服务完成生成；项目文件存于本地，不意味着模型推理也在本机。请按自己的内容隐私要求决定是否使用生成和检查功能。

DeepSeek、OpenAI API 产品接入、Web SaaS、云账号、CodexAgentConnector，以及 Codex 历史重提交、stale regeneration 和冲突自动修复，不在当前桌面交付范围内。仓库内保留的 legacy provider 和实验命令不构成相应产品承诺。

## 开发与验证

```bash
corepack pnpm build
corepack pnpm check
corepack pnpm --dir apps/desktop check
corepack pnpm test --maxWorkers=2
corepack pnpm --dir apps/desktop test --maxWorkers=2
corepack pnpm desktop:build
corepack pnpm --dir apps/desktop test:e2e:required
git diff --check
```

测试使用临时项目和 deterministic mock / fake Codex，不要求真实 API key。Electron required 测试需要图形会话和安全沙箱，不会靠关闭沙箱来通过。建议依次运行测试，避免多个全套同时争用内存。

本轮受控提交验收包含引擎和桌面回归、110 个持久化边界故障注入场景、预览发布中断校验和 14 项完整 Electron 测试。执行范围及最后修复后的补充验证见[验证记录](docs/superpowers/reports/2026-09-21-desktop-controlled-submission-verification.md)。这不等于新的真实 Codex 长篇质量验收。

### 目录概览

```text
apps/desktop/       Electron main / preload / React renderer
src/               TypeScript CLI、业务服务、schema、provider 和存储层
prompts/           引擎提示模板
schemas/           Provider 输出约束
fixtures/          确定性测试和 mock fixtures
tests/             引擎单元、集成与端到端测试
examples/          创意样例和 demo 脚本
docs/              设计、运维、发布与验证文档
projects/          本地生成项目，不进入 Git
```

### 常见问题

- **环境检查不可用**：先确认本机 Codex 已安装、登录且版本兼容；应用不自动安装或升级它。
- **额度不足或超时**：保留原文，原因解决后由作者重新开始；界面不会无限重启任务。底层 provider 保留现有的有界重试策略。
- **提交预览过期**：重新检查当前已采用正文，不能重复使用旧确认。
- **提交中断**：保留项目、journal 和快照并进行检查，不要删除记录来强行重试。
- **`ENOSPC: System limit for number of file watchers reached`**：通常是开发环境监听器限额，不等于小说文件损坏。
- **Chromium sandbox 报错**：修复主机沙箱配置，不使用 `--no-sandbox` 或 `--disable-setuid-sandbox` 绕过。

监听器和沙箱的详细排查步骤见[桌面 README](apps/desktop/README.md)。不要为排查问题先运行清理脚本删除真实小说项目。

## CLI 与历史发布参考

下文保留引擎命令、mock demo 和历史 RC 的详细参考。`pnpm ...` 均可替换为 `corepack pnpm ...`；命令是否属于稳定交付面，应结合所在阶段的说明判断。

## Quickstart: Mock Demo

The mock demo does not require a real API key. It initializes a project from `examples/brief.md`, generates strategy and planning artifacts, produces chapter 1, runs diagnostics and revision, commits Story State through a canon patch, inspects the result, and validates the project.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
corepack pnpm novel-loop init demo-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible demo-novel --provider mock
corepack pnpm novel-loop plan-global demo-novel --provider mock
corepack pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
corepack pnpm novel-loop inspect demo-novel --debts --reader --characters --timeline --foreshadowing
corepack pnpm novel-loop validate demo-novel
```

You can run the same sequence with:

```bash
./examples/demo
```

For release-audit style verification from a clean generated demo project, run:

```bash
./examples/audit
```

## Release Candidate Usage

`v2.5.0-rc.1` is a release-candidate packaging pass over the M26.5 / v2.4.0 Codex single- and multi-chapter pilot baseline.

Stable RC delivery surface:

- Mock three-chapter closed loop through Story State commit.
- Fake Codex regression suite for local CI and release validation.
- Codex read-only execution boundary and `provider=codex-text` pilot workflows.
- Real local Codex single-chapter smoke as a verified pilot workflow when the operator has a working local Codex login.

Experimental or internal commands included in the build but not promoted to stable RC APIs:

- `novel-loop codex multi-chapter-pilot`: experimental pilot only; no production stability guarantee.
- `novel-loop codex benchmark`: pilot diagnostic tooling.
- `novel-loop codex profile-runtime`, `novel-loop codex call-reduction`, `novel-loop codex optimize-runtime`: internal/experimental reports.
- `novel-loop evaluate-continuity`: internal/experimental local drift check.
- `novel-loop prompts audit`: internal prompt-pack inspection.
- `novel-loop providers list` includes legacy `real` / `openai` entries marked `status=legacy-out-of-scope`; they are not part of the RC acceptance surface.

Release checkpoint:

- `docs/releases/v2.5.0-rc.1-release-checkpoint.md`

Codex pilot operator runbook:

- `docs/operations/codex-pilot-runbook.md`

Required release verification:

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm novel-loop audit demo-novel --strict
corepack pnpm novel-loop artifacts demo-novel --refresh
corepack pnpm novel-loop runs demo-novel
corepack pnpm novel-loop verify-snapshots demo-novel
```

## CI Gate

The required CI job is `.github/workflows/ci.yml` job `build-and-test`.

It runs:

- `corepack pnpm install --frozen-lockfile`
- `corepack pnpm check`
- `corepack pnpm check:diff`
- `corepack pnpm build`
- `corepack pnpm test`
- `corepack pnpm novel-loop --version`
- `corepack pnpm novel-loop --help`

Real Codex smoke, real Codex benchmark, DeepSeek, OpenAI API, and Web UI checks are not required CI jobs. The `dependency-audit` job runs `corepack pnpm audit --audit-level high` with `continue-on-error: true`, so transient registry or transitive dependency noise does not block the main release path.

Clean generated local artifacts:

```bash
corepack pnpm clean:demo
corepack pnpm clean:test
corepack pnpm clean:generated
corepack pnpm release:checklist
```

## Package Release

The package uses a `files` whitelist in `package.json`. Runtime package contents are limited to built CLI output, prompts, provider output schemas, examples, mock fixtures, benchmark baseline data, release/operator docs, and maintenance scripts.

Before publishing a release candidate, verify package contents:

```bash
corepack pnpm build
npm pack --dry-run --json
node dist/cli/index.js --help
node dist/cli/index.js --version
```

The package must include `dist/cli/index.js` and must not include `projects/`, local audit outputs, snapshots, run artifacts, tests, `.env`, token files, or raw Codex outputs.

## Commit Safety Journal

Normal mock commits and confirmed Codex controlled commits write `chapters/chapter_XXX/commit_journal_vN.json` before Story State mutation. The journal records commit phases such as prepared, before snapshot, Story State write, after snapshot, commit report, queue commit, and completion.

`novel-loop audit <projectId> --strict` validates existing commit journals. An incomplete or invalid journal is reported as a blocking `commit_journal` issue so an operator can inspect the journal, snapshots, commit report, and queue before retrying. The journal is a focused safety record, not a full transaction manager; Codex historical recommit and Codex stale-regeneration commit remain outside this release-candidate scope.

Generate a long-project stress fixture without provider calls:

```bash
corepack pnpm novel-loop stress-fixture stress-fixture --chapters 40 --runs-per-chapter 2
corepack pnpm novel-loop artifacts stress-fixture --refresh
corepack pnpm novel-loop audit stress-fixture --strict --fix-index
```

Preview retention and provenance compaction before applying:

```bash
corepack pnpm novel-loop retention demo-novel --keep-runs 50
corepack pnpm novel-loop compact-provenance demo-novel --max-events-per-run 200
```

## Codex Execution Boundary

M21 added the local Codex CLI boundary that M22 now uses for `CodexTextProvider`. This is not a DeepSeek integration and does not add OpenAI API calls. The boundary executes local `codex` with conservative defaults and records provenance without allowing Story State mutation.

Default safety policy:

- `sandbox=read-only`
- workspace writes disabled by policy
- shell commands disabled by policy
- Story State commit disabled
- raw Codex JSONL output is redacted before persistence
- auth/token files are not read by Novel Loop Engine and are not logged

Health and smoke commands:

```bash
corepack pnpm novel-loop codex status
corepack pnpm novel-loop codex smoke
```

Schema-constrained JSON execution:

```bash
corepack pnpm novel-loop codex exec-json \
  --prompt ./examples/codex_json_prompt.md \
  --schema ./examples/codex_output.schema.json
```

Text execution:

```bash
corepack pnpm novel-loop codex exec-text --prompt ./examples/codex_json_prompt.md
```

Use `--codex-bin <path>` when `codex` is not on `PATH`. Codex artifacts are saved under `projects/<projectId>/codex/runs/<runId>/`, and each call writes a Run Manifest v2 plus `events.ndjson`.

## CodexTextProvider

M22 wrapped the M21 Codex boundary as `provider=codex-text`. M23 hardens it for novel dry-run workflows by splitting large JSON tasks, using slim output schemas, retrying/repairing invalid JSON, and recording failure artifacts. It implements the same `LLMClient` boundary used by mock and real providers, so business services still call `complete()` instead of spawning Codex directly.

Provider discovery:

```bash
corepack pnpm novel-loop providers list
corepack pnpm novel-loop providers inspect codex-text
```

Supported CodexTextProvider generation modes:

```bash
corepack pnpm novel-loop init codex-novel --brief ./examples/brief.md
corepack pnpm novel-loop build-bible codex-novel --provider codex-text --codex-profile clean
corepack pnpm novel-loop plan-global codex-novel --provider codex-text --codex-profile clean --codex-json-retries 2 --codex-json-repair
corepack pnpm novel-loop chapter codex-novel 1 --provider codex-text --dry-run --codex-profile clean --codex-json-retries 2 --codex-json-repair
corepack pnpm novel-loop chapter codex-novel 1 --provider codex-text --until draft --codex-profile clean --codex-json-retries 2 --codex-json-repair
corepack pnpm novel-loop validate codex-novel
corepack pnpm novel-loop audit codex-novel --strict
```

Safety policy:

- `codex-text` always uses the local Codex CLI through the read-only execution boundary.
- `supportsWorkspaceWrite=false`, `defaultSandbox=read-only`, and `allowCommitByDefault=false`.
- `chapter --provider codex-text --commit` is allowed only as M24 controlled commit for the normal next uncommitted chapter.
- Without `--confirm-codex-commit`, controlled commit is preview-only and does not mutate `state/story_state.json`.
- With `--confirm-codex-commit`, Story State is updated only by local schema validation, conflict checks, approval record, before/after snapshots, and local `applyCanonPatchToStoryState`.
- Post-draft full production without commit, conflict repair commit, stale regeneration commit, `commit-chapter`, and `recommit` remain blocked for `codex-text`.
- Historical recommit and stale regeneration commit through `codex-text` are explicitly blocked with M24-specific error codes.

Output schema model:

- Provider-level JSON Schemas live in `schemas/codex-output/`.
- M23 slim schemas live in `schemas/codex-output/slim/` and keep Codex JSON tasks shallow and closed with `additionalProperties=false`.
- `CodexTextProvider.generateJson()` passes the schema path to `codex exec --output-schema`.
- Novel Loop Engine then parses and validates the final output locally again before writing schema-governed JSON artifacts.
- Slim Codex output is normalized into the internal Zod schemas before any application artifact is written.
- If normalization fails, `codex/failures/<runId>/normalization_error.json` is written and the final application JSON artifact is not written.
- Existing Zod schemas remain the canonical application validation layer; provider output schemas are an execution boundary for Codex responses.

Dry-run hardening:

- `plan-global --provider codex-text` is split into `planning.generate_global_outline_text`, `planning.generate_volume_outline_text`, `planning.generate_arc_map_minimal_json`, `planning.generate_chapter_queue_minimal_json`, and `planning.validate_and_assemble`.
- `chapter --provider codex-text --dry-run` uses slim mission, plan candidate, and ranking prompts.
- `chapter --provider codex-text --until draft` uses slim scene-card generation and Codex text scene drafting.
- `--codex-profile default|clean|debug` is recorded in Run Manifest v2 prompt provenance. `clean` keeps the same read-only boundary and uses ephemeral Codex execution.
- `--codex-json-retries <n>`, `--codex-json-repair`, and `--codex-json-repair-retries <n>` control JSON retry and repair. Repair prompts only fix JSON structure and must pass `--output-schema` plus local validation.
- Minimal context manifests are written under `codex/context/context_manifest_vN.json`; they record included and excluded artifacts with reasons so raw run dumps are not fed back into prompts.
- Failure reports are written under `codex/failures/<runId>/codex_failure_report.json` with redacted stderr excerpts, attempts, repair attempts, schema path, and `storyStateMutated=false`.
- Plugin/skill manifest warnings in stderr do not fail a call when final output exists and validates. Missing final output, invalid JSON, schema failure, timeout, and exec failures are classified.

Controlled commit:

```bash
corepack pnpm novel-loop chapter codex-novel 1 --provider codex-text --max-revisions 2 --commit
corepack pnpm novel-loop chapter codex-novel 1 --provider codex-text --max-revisions 2 --commit --confirm-codex-commit
```

The first command writes a preview: diagnostics, revision plan, `final.md`, `canon_patch_codex_proposal_vN.json`, and a state diff. It prints `previewOnly=true` and a suggested confirmation command. The second command requires the same local safety chain, then writes `codex_approval_record_vN.json`, `canon_patch.json`, `commit_report.json`, `codex_commit_report_vN.json`, before/after snapshots, and Run Manifest v2 state mutation provenance. Codex never writes Story State directly.

M25 hardens the controlled commit path for a real local Codex run:

- `codex status` and `providers inspect codex-text` report layered health: `binaryAvailable`, `loginAvailable`, `doctorHealthy`, `execSmokeOk`, `execJsonOk`, and `providerAvailable`. A doctor warning is non-blocking when smoke/json pass.
- Preview writes both `canon_patch_codex_proposal_vN.json` and `canon_patch_codex_normalized_vN.json`.
- Confirm defaults to reusing the latest valid preview artifacts and refuses reuse with `CODEX_PREVIEW_STALE` if Story State changed after preview. Use `--rerun-codex-on-confirm` to force a new Codex call.
- `codex_commit_consistency_report_vN.json` records preview/confirmed patch and state diff equivalence.
- `codex_chapter_quality_report_vN.json` and `.md` are deterministic local reports. They do not call Codex or mutate Story State.
- Critical local quality issues block commit before Story State mutation: missing `final.md`, unresolved placeholders, invalid canon patch schema, or diagnostics hard-check failure.
- Patch/schema failures write `codex_patch_failure_report_vN.json` with redacted excerpts, schema/normalization summaries, suggested fixes, and a retry command.

Single-chapter Codex smoke:

```bash
corepack pnpm build
corepack pnpm run demo:codex-single-chapter
```

Equivalent CLI:

```bash
corepack pnpm novel-loop codex single-chapter-smoke --project-id codex-single --brief ./examples/brief.md
```

The smoke initializes a clean project, runs Codex build-bible, plan-global, chapter planning/draft, preview commit, confirmed commit, quality report, validate, audit, and inspect. It writes `audit/codex_single_chapter_smoke_report_vN.json` and `.md`.

Multi-chapter Codex pilot:

```bash
corepack pnpm build
corepack pnpm run demo:codex-multi-chapter
```

Equivalent CLI:

```bash
corepack pnpm novel-loop codex multi-chapter-pilot \
  --project-id codex-multi \
  --brief ./examples/brief.md \
  --chapters 3 \
  --codex-profile clean \
  --codex-json-retries 2 \
  --codex-json-repair
```

The pilot initializes a clean project, runs Codex strategy/planning, then advances chapters 1-3 one at a time. Each chapter writes a draft, creates a preview-only controlled commit, confirms by reusing the preview artifacts, evaluates local quality, validates, and commits Story State only through local `applyCanonPatchToStoryState`. It writes `audit/codex_multi_chapter_pilot_report_vN.json` and `audit/codex_cross_chapter_drift_report_vN.json`.

M26 safety model:

- `chapter next` for Codex remains normal-next only: `latestCommittedChapter + 1`.
- Preview-only Codex commit must not mutate `state/story_state.json`.
- Confirm requires the preview Story State hash to still match current Story State.
- `--confirm` on the multi-chapter pilot is blocked with `CODEX_BATCH_CONFIRM_BLOCKED`; the pilot always uses per-chapter preview/confirm checkpoints.
- Per-chapter budgets default to `--codex-max-calls-per-chapter 20`, `--codex-max-runtime-ms-per-chapter 900000`, and `--codex-timeout-ms 180000`.
- Budget exhaustion writes `audit/codex_budget_report_vN.json` and stops before uncontrolled Story State mutation.
- Diagnostics score normalization is traceable in `diagnostics_vN.json`, `codex_chapter_quality_report_vN.json`, and drift warnings.
- Resume is available with `corepack pnpm run demo:codex-multi-chapter -- --resume`; committed chapters are not repeated.

Codex runtime benchmark:

```bash
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level health --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level bible --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level plan --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level draft --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level preview --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --brief ./examples/brief.md --level confirm --codex-profile clean --timeout-ms 180000
```

Only after those levels pass, continue with:

```bash
corepack pnpm novel-loop codex benchmark --project-id codex-bench --level chapter2 --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop codex benchmark --project-id codex-bench --level chapter3 --codex-profile clean --timeout-ms 180000
corepack pnpm novel-loop validate codex-bench
corepack pnpm novel-loop audit codex-bench --strict --fix-index
```

`codex benchmark` writes `audit/codex_runtime_benchmark_report_vN.json/.md` and, on failures, `audit/codex_runtime_failure_report_vN.json`. Each stage records duration, Codex call counts, retry/repair/timeout counts, prompt/schema/output/raw JSONL byte counts, artifact counts, Story State mutation status, and suggested retry commands. Use `--resume` to continue from existing preview or committed artifacts, `--continue-on-failure` for diagnostic sweeps, `--compare-profiles clean,debug` to compare runtime profiles, and `--profile-stages` to also write `audit/codex_stage_runtime_profile_vN.json/.md`.

Continuity drift and v2 continuity check only:

```bash
corepack pnpm novel-loop evaluate-continuity codex-multi --chapters 1-3
```

Local quality check only:

```bash
corepack pnpm novel-loop evaluate-chapter codex-single 1
```

Debugging Codex JSON failures:

```bash
corepack pnpm novel-loop providers inspect codex-text
corepack pnpm novel-loop runs codex-novel --status failed
corepack pnpm novel-loop run codex-novel <runId> --events
corepack pnpm novel-loop artifacts codex-novel --type codex_final_output --refresh
```

Then inspect `projects/codex-novel/codex/failures/<runId>/codex_failure_report.json` and the related `codex/runs/<childRunId>/raw_output.jsonl`, `final_output.json`, and `parsed_output.json`.

Provenance and redaction:

- Codex raw JSONL, final text/json, and parsed JSON artifacts are saved under `projects/<projectId>/codex/runs/<runId>/`.
- Run Manifest v2 prompt calls record `provider=codex-text`, `transport=cli`, Codex version, `sandbox=read-only`, output schema path, hashes, raw/final/parsed output paths, latency, parse status, schema status, and redaction status.
- `events.ndjson` records prompt call and artifact events.
- Raw Codex output is redacted before persistence. `NLE_REDACT_PROMPT_ARTIFACTS=true` additionally redacts persisted prompt request/response artifact content while keeping hashes and provenance.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm novel-loop --help
pnpm novel-loop init demo-novel --brief ./examples/brief.md
pnpm novel-loop validate demo-novel
pnpm novel-loop build-bible demo-novel --provider mock
pnpm novel-loop plan-global demo-novel --provider mock
pnpm novel-loop providers list
pnpm novel-loop providers inspect codex-text
pnpm novel-loop chapter demo-novel 1 --provider mock --dry-run --candidates 3
pnpm novel-loop chapter demo-novel 1 --provider mock --until draft
pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2
pnpm novel-loop chapter demo-novel 1 --provider mock --max-revisions 2 --commit
pnpm novel-loop chapter demo-novel next --provider mock --max-revisions 2 --commit
pnpm novel-loop chapter demo-novel next --provider mock --resume --max-revisions 2 --commit
pnpm novel-loop chapter demo-novel next --provider mock --mock-scenario patch-conflict-timeline --max-revisions 2 --commit
pnpm novel-loop chapter demo-novel next --provider mock --resume --repair-conflicts --max-conflict-repairs 2 --commit
pnpm novel-loop review demo-novel 3 --diagnostics --state --artifacts --suggest-next
pnpm novel-loop diff-state demo-novel --patch ./projects/demo-novel/chapters/chapter_003/canon_patch.json
pnpm novel-loop recommit demo-novel 3 --from-final --provider mock
pnpm novel-loop recommit demo-novel 3 --from-final --provider mock --confirm
pnpm novel-loop recommit demo-novel 2 --from-final --provider mock --allow-historical-recommit --mark-downstream-stale
pnpm novel-loop recommit demo-novel 2 --from-final --provider mock --allow-historical-recommit --mark-downstream-stale --confirm
pnpm novel-loop stale demo-novel
pnpm novel-loop regeneration-plan demo-novel --from 3
pnpm novel-loop chapter demo-novel next --provider mock --regenerate-stale --max-revisions 2 --commit
pnpm novel-loop chapter demo-novel next --provider mock --regenerate-stale --reuse-policy reference_only --max-revisions 2 --commit
pnpm novel-loop evaluate-chapter codex-novel 1
pnpm novel-loop codex single-chapter-smoke --project-id codex-single --brief ./examples/brief.md
pnpm novel-loop codex multi-chapter-pilot --project-id codex-multi --brief ./examples/brief.md --chapters 3
pnpm novel-loop evaluate-continuity codex-multi --chapters 1-3
pnpm novel-loop artifacts demo-novel --refresh
pnpm novel-loop artifacts demo-novel --chapter 3
pnpm novel-loop runs demo-novel
pnpm novel-loop run demo-novel <runId>
pnpm novel-loop run demo-novel <runId> --events
pnpm novel-loop run demo-novel <runId> --artifacts
pnpm novel-loop run demo-novel <runId> --state
pnpm novel-loop snapshots demo-novel
pnpm novel-loop snapshot demo-novel <snapshotId>
pnpm novel-loop verify-snapshots demo-novel
pnpm novel-loop audit demo-novel --strict
pnpm novel-loop audit demo-novel --fix-index
pnpm novel-loop stress-fixture stress-fixture --chapters 40 --runs-per-chapter 2
pnpm novel-loop retention demo-novel --keep-runs 50
pnpm novel-loop retention demo-novel --keep-runs 50 --apply
pnpm novel-loop compact-provenance demo-novel --max-events-per-run 200
pnpm novel-loop compact-provenance demo-novel --max-events-per-run 200 --apply
pnpm novel-loop codex status
pnpm novel-loop codex smoke
pnpm novel-loop codex exec-text --prompt ./examples/codex_json_prompt.md
pnpm novel-loop codex exec-json --prompt ./examples/codex_json_prompt.md --schema ./examples/codex_output.schema.json
pnpm novel-loop build-bible codex-novel --provider codex-text --codex-profile clean
pnpm novel-loop plan-global codex-novel --provider codex-text --codex-profile clean --codex-json-retries 2 --codex-json-repair
pnpm novel-loop chapter codex-novel 1 --provider codex-text --dry-run --codex-profile clean --codex-json-retries 2 --codex-json-repair
pnpm novel-loop chapter codex-novel 1 --provider codex-text --until draft --codex-profile clean --codex-json-retries 2 --codex-json-repair
pnpm novel-loop inspect demo-novel --debts --reader --characters --timeline --foreshadowing
pnpm novel-loop rollback demo-novel --snapshot <snapshotId>
pnpm novel-loop commit-chapter demo-novel 1 --provider mock
```

The CLI currently supports help/version plus project `init`, `validate`, `build-bible`, `plan-global`, `providers`, `chapter --dry-run`, `chapter --until draft`, `chapter --max-revisions`, `chapter --commit`, `chapter next`, `chapter --resume`, `chapter --repair-conflicts`, `chapter --regenerate-stale`, `review`, `diff-state`, `recommit`, `stale`, `regeneration-plan`, `artifacts`, `runs`, `run`, `snapshots`, `snapshot`, `verify-snapshots`, `audit`, `stress-fixture`, `retention`, `compact-provenance`, `codex`, `evaluate-continuity`, `inspect`, `rollback`, and `commit-chapter`. Web UI is intentionally not implemented.

## Project Layout

```text
src/
  cli/
  app/
  engine/
  schemas/
  llm/
  prompts/
  storage/
  logging/
  utils/

prompts/
  strategy/
  planning/
  production/
  diagnostics/
  revision/
  memory/

tests/
  fixtures/
  unit/
  integration/
```

## Schemas

Core schemas live in `src/schemas/` and export TypeScript types inferred from Zod schemas. Fixture coverage lives in `tests/fixtures/schemas/` and `tests/unit/schemas/`.

## Storage

File-system infrastructure lives in `src/storage/` and `src/logging/`:

- `ProjectPaths` centralizes project path generation.
- `AtomicWriter` writes temp files and then renames them into place.
- `FileStore` reads/writes text and schema-validated JSON.
- `SnapshotStore` creates and reads Story State snapshots.
- `RunLogger` creates and updates run manifests.

## Project Commands

- `novel-loop init <projectId> --brief <path>` creates a local project under `./projects` by default.
- `novel-loop validate <projectId>` checks the project directory, `brief.md`, `config.json`, `state/story_state.json`, and required artifact directories including `diffs/`.

## Prompts And Mock LLM

- `PromptService` loads prompt templates from `prompts/<namespace>/<name>.md`.
- `TemplateRenderer` replaces `{{PLACEHOLDER}}` values and fails when a placeholder is missing.
- `LLMClient` defines the provider boundary used by business code.
- `MockLLMClient` reads deterministic fixtures by `promptId` and scenario.
- `JsonResponseParser` accepts pure JSON and fenced JSON, and throws clear errors for invalid JSON.
- Codex boundary commands use local `codex exec --sandbox read-only --json --output-last-message`, and JSON mode adds `--output-schema`.
- Codex raw output, final output, and parsed JSON artifacts are stored under `codex/runs/<runId>/` with Run Manifest v2 provenance.
- `CodexTextProvider` selects the same boundary with `--provider codex-text` for strategy, global planning, chapter dry-run, and chapter draft generation.
- Provider registry commands expose capabilities and health checks without changing Story State.
- Legacy `RealLLMClient` support exists in the codebase but is outside the `v2.5.0-rc.1` acceptance surface.
- Legacy real provider config is read from `.env` / environment: `NLE_REAL_API_KEY`, `NLE_REAL_MODEL`, optional `NLE_REAL_BASE_URL`, timeout, retry, and cost fields.
- Provider usage metadata is appended to each run manifest under `llmCalls`.
- Set `NLE_REDACT_PROMPT_ARTIFACTS=true` to store redacted prompt request/response artifacts.

## Strategy And Planning

- `novel-loop build-bible <projectId> --provider mock` writes Story Bible, Genre Contract, Reader Promise, and Style Guide markdown.
- `novel-loop plan-global <projectId> --provider mock` writes global outline markdown, volume outline markdown, `arc_map.json`, and `chapter_queue.json`.
- Planning JSON artifacts are validated with `ArcMapSchema` and `ChapterQueueSchema` before write.
- Each command creates a run manifest and stores rendered prompt request/response artifacts under `runs/<runId>/prompts/`.

## Chapter Planning

- `novel-loop chapter <projectId> <chapterNumber> --provider mock --dry-run --candidates 3` writes planning artifacts only.
- `novel-loop chapter <projectId> next --provider mock --max-revisions 2 --commit` resolves `next` as `latestCommittedChapter + 1`.
- Committed chapters cannot be recommitted by default.
- `mission.json` is validated with `ChapterMissionSchema`.
- Candidate plans are stored as markdown files under `plan_candidates/`.
- `ranking.json` is validated with `ChapterPlanRankingSchema`.
- `selected_plan.md` is copied from the selected candidate plan.
- Dry-run does not write draft/final prose and does not update Story State.

## Chapter Queue Lifecycle And Resume

- `planning/chapter_queue.json` is a lifecycle table, not only a static outline.
- Each chapter tracks `status`, `currentStage`, `completedStages`, run id, timestamps, commit time, failure reason, and artifact path.
- Statuses include `planned`, `planning`, `planned_ready`, `drafting`, `draft_ready`, `diagnosing`, `revision_required`, `revising`, `final_ready`, `patch_extracted`, `committing`, `committed`, `recommitting`, `recommitted`, `stale_due_to_history_edit`, `failed`, `blocked`, and `needs_human_review`.
- Stages include `mission`, `plan_candidates`, `ranking`, `scene_cards`, `scene_drafts`, `draft_assembly`, `diagnostics`, `revision`, `final`, `canon_patch`, and `commit`.
- `novel-loop chapter <projectId> next --provider mock --resume --max-revisions 2 --commit` resumes the first failed or in-progress chapter in queue order.
- Resume reuses valid existing artifacts: `mission.json`, `selected_plan.md`, `scene_cards.json`, scene drafts, `draft_v1.md`, `final.md`, and `canon_patch.json`.
- Repeating `--dry-run` or `--until draft` does not update Story State.
- Committed chapters cannot be recommitted or resumed by default.
- Regenerating one non-committed artifact stage requires `--force-stage <stage>`; `--force-stage` is blocked for committed chapters.
- `validate` checks `planning/chapter_queue.json` when present and reports contradictions with `state/story_state.json`.

## Chapter Drafting

- `novel-loop chapter <projectId> <chapterNumber> --provider mock --until draft` starts from `selected_plan.md`.
- `scene_cards.json` is validated with `SceneCardsSchema`.
- Each scene draft is stored independently under `scenes/`.
- `draft_v1.md` is assembled by concatenating scene drafts; assembly does not rewrite prose.
- Drafting does not write `final.md` and does not update Story State.

## Diagnostics And Revision

- `novel-loop chapter <projectId> <chapterNumber> --provider mock --max-revisions 2` starts from `draft_v1.md`.
- `diagnostics_vN.json` is validated with `DiagnosticsReportSchema`.
- `qualityGate` blocks final output if any hard check fails or the soft score average is below `qualityThreshold`.
- `revision_plan_vN.json` is validated with `RevisionPlanSchema`.
- Each revised draft is saved as `draft_v<N+1>.md`.
- Passing diagnostics writes `final.md`; exhausted revisions write `needs_human_review.md` and schema-validated `failure_report.json`.

## Canon Commit

- `novel-loop chapter <projectId> <chapterNumber> --provider mock --max-revisions 2 --commit` commits only after `final.md` passes diagnostics.
- `canon_patch.json` is extracted from `final.md` and validated with `CanonPatchSchema`; the LLM never writes `story_state.json` directly.
- `checkPatchConflicts` blocks hard conflicts before state mutation and writes structured conflict reports when needed.
- `commitChapterState` creates a before snapshot, applies the patch through local code, creates an after snapshot, and writes `commit_report.json`.
- `commit_report.json` records applied changes, conflict results, repair metadata, and snapshot metadata.

## Conflict Recovery

- By default, a blocking canon patch conflict stops commit, writes `conflict_report_vN.json`, marks the queue item `blocked` at `commit`, and leaves `state/story_state.json` unchanged.
- `--repair-conflicts --max-conflict-repairs <n>` enables automatic repair for safe mock scenarios. The pipeline writes `patch_repair_plan_vN.json`, `canon_patch_repaired_vN.json`, revalidates with `CanonPatchSchema`, reruns conflict checks, and commits only if the repaired patch is clean.
- Successful repair writes `conflict_repair_report_vN.json` with `committed=true`; `commit_report.json` records `repaired=true`, `originalPatchPath`, `repairedPatchPath`, and conflict report paths.
- Failed repair writes `needs_human_review.md` and `failure_report.json`, marks the queue item `needs_human_review`, and does not mutate Story State.
- Versioned recovery artifacts are append-only: repeated conflict runs write `v2`, `v3`, and so on instead of overwriting older reports.
- Resume integrates with recovery. A blocked chapter without `--repair-conflicts` prints a suggested next command; with `--repair-conflicts`, resume repairs from the conflict stage. If `canon_patch_repaired_vN.json` already exists after an interrupted commit, resume reuses it for final conflict check and commit.

Conflict recovery demo after chapters 1-3 are committed:

```bash
corepack pnpm novel-loop chapter demo-novel next --provider mock --mock-scenario patch-conflict-timeline --max-revisions 2 --commit
corepack pnpm novel-loop chapter demo-novel next --provider mock --resume --repair-conflicts --max-conflict-repairs 2 --commit
```

Deterministic mock conflict scenarios include `patch-conflict-timeline`, `patch-conflict-character-state`, `patch-conflict-debt-invalid`, `patch-conflict-reader-leak`, `patch-conflict-unrepairable`, `patch-conflict-malformed-repair`, and `patch-conflict-still-conflicting`.

## Human Review And Controlled Recommit

- `novel-loop review <projectId> <chapterNumber> --conflicts --diagnostics --state --artifacts --suggest-next` is read-only. It reports queue status, current stage, final path, diagnostics summary, conflict/repair/commit report paths, failure reason, open narrative debts, reader expectations, and a suggested next command.
- `novel-loop diff-state <projectId> --from <snapshotA> --to <snapshotB>` compares two Story State snapshots and writes `diffs/state_diff_<timestamp>.json` plus `.md`.
- `novel-loop diff-state <projectId> --patch <canonPatchPath>` validates the patch, previews projected changes, and marks `unsafeToCommit=true` when conflict checks fail. It never writes `state/story_state.json`.
- `novel-loop recommit <projectId> <chapterNumber> --from-final --provider mock` extracts `canon_patch_manual_vN.json`, writes `manual_review_report_vN.json`, writes a state diff preview, writes `recommit_report_vN.json`, and stops with `previewOnly=true`; Story State is not modified.
- `novel-loop recommit <projectId> <chapterNumber> --from-final --provider mock --confirm` performs the same validation, writes `approval_record_vN.json`, creates before/after snapshots, applies the patch through local code, writes `recommit_report_vN.json`, and updates the queue to `recommitted` for the latest committed chapter.
- `novel-loop recommit <projectId> <chapterNumber> --from-patch <path> --confirm` copies the user-supplied patch to `canon_patch_manual_vN.json`, validates it with `CanonPatchSchema`, runs conflict checks, writes a diff preview, and commits only when clean and confirmed.
- Historical recommit is blocked by default with `HISTORICAL_RECOMMIT_BLOCKED` when `chapterNumber < latestCommittedChapter`.

## Historical Recommit And Downstream Invalidation

Historical edits can invalidate later chapters because the live Story State may already contain canon facts, timeline events, reader knowledge, debts, and foreshadowing introduced downstream. M17 keeps that safe by rebasing from the target chapter's canonical base instead of patching the current full state.

- `novel-loop recommit <projectId> <chapterNumber> --from-final --provider mock --allow-historical-recommit --mark-downstream-stale` creates a preview only. It writes a manual patch, state diff, and downstream invalidation preview; it does not change `state/story_state.json` or `planning/chapter_queue.json`.
- `novel-loop recommit <projectId> <chapterNumber> --from-final --provider mock --allow-historical-recommit --mark-downstream-stale --confirm` performs controlled historical recommit.
- For chapter 1, the base state is the initial project state. For chapter N, the base state is the `after_chapter_{N-1}_commit` snapshot. Missing base snapshots block with `BASE_SNAPSHOT_NOT_FOUND`.
- The canon patch is validated with `CanonPatchSchema`, checked for conflicts against the base state, then applied by local code. The LLM never writes `story_state.json` directly.
- Confirmed historical recommit creates a before snapshot of the old full state, writes the rebased state through the edited chapter, creates an after snapshot, and sets `latestCommittedChapter` back to the edited chapter number.
- Downstream chapters are marked `stale_due_to_history_edit`; old `final.md`, `canon_patch.json`, `commit_report.json`, scenes, and other artifacts are preserved.
- New artifacts include `historical_recommit_report_vN.json`, `downstream_invalidation_report_vN.json`, and `planning/regeneration_plan_vN.json` / `.md`.
- `validate` allows `latestCommittedChapter` to move backward only when downstream stale status and downstream invalidation reports explain the gap. It also rejects Story State that still contains canon facts or timeline events from stale chapters.

Example historical recommit flow after committing chapters 1-3:

```bash
corepack pnpm novel-loop recommit demo-novel 2 --from-final --provider mock --allow-historical-recommit --mark-downstream-stale
corepack pnpm novel-loop recommit demo-novel 2 --from-final --provider mock --allow-historical-recommit --mark-downstream-stale --confirm
corepack pnpm novel-loop stale demo-novel
corepack pnpm novel-loop regeneration-plan demo-novel --from 3
corepack pnpm novel-loop chapter demo-novel next --provider mock --regenerate-stale --max-revisions 2 --commit
corepack pnpm novel-loop validate demo-novel
```

## Stale Chapters And Regeneration Plan

- `novel-loop stale <projectId>` is read-only. It prints stale chapter count, chapter numbers, invalidation reason, old artifact paths, and the suggested regeneration command.
- `novel-loop stale <projectId> --chapter <chapterNumber>` narrows output to one stale chapter.
- `novel-loop stale <projectId> --json` prints structured stale data.
- `novel-loop regeneration-plan <projectId> --from <chapterNumber>` reads `chapter_queue.json`, finds stale downstream chapters from that chapter onward, writes `planning/regeneration_plan_vN.json` and `.md`, and does not modify Story State or chapter artifacts.
- `novel-loop chapter <projectId> next --provider mock --regenerate-stale --max-revisions 2 --commit` chooses the earliest `stale_due_to_history_edit` chapter instead of `latestCommittedChapter + 1`.
- Before stale regeneration starts, the engine writes `chapters/chapter_YYY/archive/history_edit_<timestamp>/manifest.json` listing old artifacts and the invalidation reason. It does not delete old artifacts.
- Successful stale regeneration reruns the full pipeline and advances `latestCommittedChapter`; failed regeneration marks the queue item failed or review-bound while preserving the rebased Story State and archive manifest.

## Archive Model

- Stale regeneration writes a full archive under `chapters/chapter_YYY/archive/history_edit_<timestamp>/`.
- `manifest.json` is validated with `ArchiveManifestSchema`.
- Old chapter files are copied into `copied_artifacts/`, including old `final.md`, `canon_patch.json`, `commit_report.json`, diagnostics, revision plans, `selected_plan.md`, `scene_cards.json`, scenes, and historical/recommit artifacts when present.
- Each copied file records `originalPath`, `archivedPath`, `artifactType`, `sha256`, and `sizeBytes`.
- Missing expected core artifacts are recorded in `missingArtifacts`.
- `audit` verifies archive manifest schema and copied file hashes.

## Artifact Index

- `novel-loop artifacts <projectId> --refresh` scans the project and writes `artifacts/artifact_index.json`.
- `novel-loop artifacts <projectId>` is read-only unless `--refresh` is passed.
- Filters: `--chapter <chapterNumber>`, `--type <artifactType>`, `--status active|archived|stale|missing|invalid`, and `--json`.
- Indexed entries include path, chapter, type, phase, hash, size, schema name when applicable, status, and provenance.

## Run Browser

- `novel-loop runs <projectId>` lists run manifests with counts, failed run count, last run, and a suggested inspect command for failed runs.
- Filters: `--limit <count>`, `--status success|failed`, `--chapter <chapterNumber>`, and `--json`.
- New runs write `runs/<runId>/run_manifest.json` with `schemaVersion: "2"` and `runs/<runId>/events.ndjson`.
- Run Manifest v2 records resolved context, command metadata, summary counts, artifact lineage, queue transitions, state mutations, snapshots, archive/reuse records, prompt calls, redaction policy, and errors.
- `events.ndjson` is append-only. It records events such as `RUN_STARTED`, `STAGE_STARTED`, `ARTIFACT_GENERATED`, `PROMPT_CALL_STARTED`, `PROMPT_CALL_COMPLETED`, `QUEUE_TRANSITION`, `STATE_MUTATION_APPLIED`, `SNAPSHOT_CREATED`, and `RUN_COMPLETED`.
- `novel-loop run <projectId> <runId>` prints command, status, timing, provider/mock scenario, chapter, inferred stages, artifact lineage, errors, prompt calls, queue transitions, state mutations, and snapshot ids.
- Extra detail flags: `--events`, `--artifacts`, and `--state`.
- Legacy run manifests are still readable. They are reported as `schemaVersion=legacy`, have no event log, and may produce audit warnings instead of hard crashes.
- Run browser commands are read-only and do not trigger provider calls.

## Artifact Lineage And Provenance

- Every newly generated run records artifact lineage with action, phase, path, run id, sha256, size, schema name where applicable, and provenance metadata.
- Stale regeneration records archived artifact lineage and reuse policy records before new chapter generation starts.
- `artifacts --refresh` merges filesystem scanning with Run Manifest v2 lineage, so generated, reused, archived, stale, missing, and invalid artifacts can be traced back to runs.
- Queue transition provenance records before/after chapter queue status, stage, reason, and related commit artifact when available.
- State mutation provenance records mutation type, target path, patch path, before/after snapshot ids, before/after state hashes, and affected fields.

## Prompt Provenance And Redaction

- Prompt calls are recorded through the `LLMClient` telemetry boundary, not by business services calling providers directly.
- Prompt provenance records prompt id, provider, model, mock scenario, latency, parse status, prompt artifact hashes, response artifact hashes, usage metadata when available, retry count, and redaction status.
- Set `NLE_REDACT_PROMPT_ARTIFACTS=true` to redact persisted prompt/response artifact contents while preserving prompt provenance and hashes.
- API keys are never written to run manifests, event logs, prompt artifacts, or audit reports.

## Snapshot Browser

- `novel-loop snapshots <projectId>` lists Story State snapshots.
- Filters: `--chapter <chapterNumber>`, `--kind before|after|initial|manual`, and `--json`.
- `novel-loop snapshot <projectId> <snapshotId>` prints snapshot metadata, latest committed chapter in the snapshot, file hash, size, and schema validity.
- `novel-loop verify-snapshots <projectId>` validates snapshots and required base snapshots, then writes `audit/snapshot_audit_report_vN.json` and `.md`.

## Project Audit

- `novel-loop audit <projectId>` writes `audit/project_audit_vN.json` and `.md`.
- Audit checks config, Story State, chapter queue, queue/state consistency, stale consistency, downstream reports, snapshots/base snapshots, archive manifests and hashes, run manifests, event logs, artifact lineage hashes, prompt artifact hashes, state mutation snapshot references, latest commit report/canon patch, stale pollution, and artifact index presence.
- `--strict` sets a non-zero exit code when error or critical issues exist.
- `--fix-index` refreshes only `artifacts/artifact_index.json`; it does not modify Story State, queue, or chapter artifacts.
- M20 audit reports include performance metadata: duration, artifact count, run manifest count, archive count, snapshot count, and indexed bytes.

## Stress, Retention, And Compaction

- `novel-loop stress-fixture <projectId> --chapters <count>` creates deterministic 1-50 chapter projects for release stress checks without provider calls.
- `novel-loop retention <projectId> --keep-runs <count>` previews run retention. No files move unless `--apply` is passed.
- Applied retention moves old run directories into `retention/runs/` and writes `audit/retention_report_vN.json`; it does not mutate Story State.
- `novel-loop compact-provenance <projectId> --max-events-per-run <count>` previews event-log compaction and writes `audit/provenance_compaction_vN.json`.
- Applied compaction preserves original large event logs as `events.full.ndjson` and replaces `events.ndjson` with a compacted schema-valid summary log.

## Reuse Policy

- Stale regeneration supports `--reuse-policy <policy>`.
- Supported policies: `preserve_nothing`, `reference_only`, `preserve_scene_structure_if_valid`, `preserve_final_text_if_unaffected`.
- Default policy is `reference_only`.
- `preserve_nothing` archives old artifacts but does not reference old final text.
- `reference_only` may record old final/scene cards as reference context, but still regenerates draft and final.
- `preserve_scene_structure_if_valid` runs a scene structure validity check; invalid structures downgrade to `reference_only`.
- `preserve_final_text_if_unaffected` is not allowed for stale chapters by default and must not silently reuse old final text.
- Each stale regeneration writes `chapters/chapter_YYY/reuse_policy_report_vN.json`.

## Inspect, Rollback, Manual Commit

- `novel-loop inspect <projectId>` shows the current Story State summary and optional sections for debts, characters, reader state, timeline, and foreshadowing.
- `novel-loop rollback <projectId> --snapshot <snapshotId>` restores `state/story_state.json` from a snapshot and writes `state/rollback_report.json`; chapter artifacts, runs, and snapshots are preserved.
- `novel-loop commit-chapter <projectId> <chapterNumber> --provider mock` recommits an existing `final.md`, useful after a human manually edits the final chapter.

## Legacy Real Provider

- The legacy `real` provider is not part of the `v2.5.0-rc.1` acceptance surface.
- Real provider requests use the existing `LLMClient` interface, so business services do not call provider-specific APIs.
- Retry/backoff handles retryable network, timeout, rate limit, and server failures.
- Provider errors are classified as `auth`, `rate_limit`, `timeout`, `network`, `server`, `invalid_json`, `provider_response`, or `unknown`.
- JSON responses use parser repair fallback for simple wrapper text and trailing comma cases.
- API keys are never written to run manifests or prompt artifacts.

## Next Milestone

Post-RC work should first address the P1 high-risk hardening items in `Plan.md`, especially the Commit Safety Journal, while keeping mock and Codex pilot regressions green. DeepSeek, OpenAI API integration, Web UI, CodexAgentConnector, and broader real Codex multi-chapter stability guarantees remain outside this release-candidate scope.
