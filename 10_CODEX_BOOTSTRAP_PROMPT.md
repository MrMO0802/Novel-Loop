# 可直接给 Codex 的启动提示词

把下面内容复制给 Codex，并把本材料包作为上下文提供。

---

你现在要实现一个生产级 TypeScript CLI 项目：`Novel Loop Engine`。

这是一个以 Story State 为核心的 AI 长篇小说生产闭环系统。它不是普通 AI 写作工具，而是一个本地优先的小说工程化创作引擎。系统通过 Story Bible、Chapter Mission、Scene Cards、Diagnostics、Revision Plan、Canon Patch 和 Story State 更新，实现长篇小说的持续、可控、可追踪创作。

请严格以以下文档为源头：

1. `01_PRODUCT_REQUIREMENTS_PRD.md`
2. `02_SOFTWARE_REQUIREMENTS_SRS.md`
3. `03_ARCHITECTURE_AND_MODULE_SPEC.md`
4. `04_DATA_MODEL_AND_SCHEMAS.md`
5. `05_PROMPT_PACK.md`
6. `06_CODEX_IMPLEMENTATION_PLAN.md`
7. `07_ACCEPTANCE_TESTS_AND_QA.md`
8. `08_OPERATIONS_OBSERVABILITY.md`
9. `09_SECURITY_PRIVACY_RISK.md`

## 总体目标

实现一个可运行的 TypeScript CLI，至少支持以下命令：

```bash
novel-loop init <projectId> --brief <path>
novel-loop validate <projectId>
novel-loop build-bible <projectId> --provider mock
novel-loop plan-global <projectId> --provider mock
novel-loop chapter <projectId> <chapterNumber|next> --provider mock
novel-loop inspect <projectId>
```

优先使用 mock provider 跑通完整 loop，然后再预留真实 provider adapter。

## 硬性架构要求

1. 使用 TypeScript。
2. 使用 Zod 定义所有核心 schema，并从 schema 推导类型。
3. CLI 只负责解析参数，不写业务逻辑。
4. 所有业务逻辑放在 `src/app` 和 `src/engine`。
5. 所有文件读写通过 `FileStore`。
6. 所有写入使用 atomic write。
7. 所有 LLM 调用通过 `LLMClient` interface。
8. 先实现 `MockLLMClient`。
9. Prompt 模板放在 `prompts/`，不要硬编码长 prompt。
10. 所有 JSON artifacts 写入前必须 schema 校验。
11. Canon Patch 不能直接覆盖 Story State，必须通过 `applyCanonPatch`。
12. 每个 run 必须生成 `run_manifest.json`。
13. 每个章节 loop 必须保存中间 artifacts。
14. 失败时不得破坏已 committed state。

## v1 必须实现的目录结构

```text
src/
  cli/
  app/
  engine/
    strategy/
    planning/
    production/
    diagnostics/
    revision/
    memory/
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

## 第一阶段请实现 M0-M3

请先实现：

1. package/tsconfig/vitest 配置。
2. CLI skeleton。
3. 所有核心 Zod schema。
4. FileStore、ProjectPaths、AtomicWriter、SnapshotStore。
5. `init` 命令。
6. `validate` 命令。
7. 基础测试。

完成后必须能运行：

```bash
pnpm install
pnpm build
pnpm test
pnpm novel-loop --help
pnpm novel-loop init demo-novel --brief ./examples/brief.md
pnpm novel-loop validate demo-novel
```

## 第二阶段实现 M4-M7

然后实现：

1. PromptService。
2. TemplateRenderer。
3. LLMClient interface。
4. MockLLMClient。
5. build-bible。
6. plan-global。
7. chapter loop 的 mission、plan candidates、ranking、scene cards、scene writing、assemble draft。

## 第三阶段实现 M8-M10

最后实现：

1. diagnostics。
2. revision plan。
3. revise draft。
4. quality gate。
5. extract canon patch。
6. apply canon patch。
7. commit state。
8. inspect。
9. rollback。
10. commit-chapter。

## 编码要求

- 不要用 `any`，除非 provider raw response 边界。
- 不要把所有逻辑塞进一个文件。
- 不要省略测试。
- 不要跳过 schema validation。
- 不要直接覆盖用户文件，除非命令明确 `--force`。
- 路径必须使用 Node path API。
- 测试必须不依赖真实 API key。
- mock provider 必须 deterministic。
- 如果需求存在不明确处，请选择最小可行但可扩展的实现，不要停下来等待确认。

## Definition of Done

最终至少要满足：

```bash
pnpm build
pnpm test
pnpm novel-loop init demo-novel --brief ./examples/brief.md
pnpm novel-loop build-bible demo-novel --provider mock
pnpm novel-loop plan-global demo-novel --provider mock
pnpm novel-loop chapter demo-novel 1 --provider mock
pnpm novel-loop inspect demo-novel
pnpm novel-loop validate demo-novel --strict
```

并且生成：

```text
projects/demo-novel/
  strategy/story_bible.md
  planning/global_outline.md
  chapters/chapter_001/final.md
  chapters/chapter_001/canon_patch.json
  state/story_state.json
  snapshots/
  runs/
```

请从 M0-M3 开始实现，保持小步提交式开发，每完成一个阶段都更新 README 和测试。
