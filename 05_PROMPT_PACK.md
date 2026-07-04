# Prompt Pack：Novel Loop Engine

## 1. Prompt 总原则

1. 每个 prompt 只做一个明确任务。
2. 规划 prompt 不写正文。
3. 诊断 prompt 不续写剧情。
4. canon patch prompt 只抽取最终稿中已经发生或明确成立的事实，不能发明新设定。
5. JSON 输出必须只输出 JSON，不要 markdown code fence。
6. 所有 prompt 输入都应包含必要上下文，但避免无限塞入全文。v1 可以使用摘要和 state；v2 再引入检索。
7. 写作 prompt 必须遵守 Story Bible、Chapter Mission 和 Scene Card。
8. Prompt 输出必须被 schema 校验，不通过则进入 format repair。

## 2. Prompt ID 列表

| Prompt ID | 输出格式 | 用途 |
|---|---|---|
| `strategy.build_story_bible` | Markdown | 从 brief 生成 Story Bible |
| `strategy.build_genre_contract` | Markdown | 生成类型文读者承诺和类型规则 |
| `strategy.build_reader_promise` | Markdown | 生成读者体验承诺 |
| `planning.plan_global_outline` | Markdown/JSON | 生成全书/分卷大纲 |
| `planning.plan_chapter_mission` | JSON | 生成章节任务 |
| `planning.generate_plan_candidates` | JSON | 生成多个章节方案 |
| `planning.rank_plan_candidates` | JSON | 评估排序章节方案 |
| `planning.generate_scene_cards` | JSON | 生成场景卡 |
| `production.write_scene` | Markdown | 写单个场景 |
| `production.assemble_chapter` | Markdown | 组装章节草稿 |
| `diagnostics.diagnose_chapter` | JSON | 诊断草稿 |
| `revision.create_revision_plan` | JSON | 生成修订计划 |
| `revision.revise_draft` | Markdown | 根据修订计划修改草稿 |
| `memory.extract_canon_patch` | JSON | 抽取 canon patch |
| `memory.repair_json_output` | JSON | 修复无效 JSON 输出格式 |

## 3. 通用 System Prompt

```text
你是 Novel Loop Engine 的一个专业模块。你必须严格执行当前模块职责，不要跨职责完成其他任务。

硬性要求：
1. 遵守用户提供的 Story Bible、Story State、Chapter Mission、Scene Card、Diagnostics 或 Revision Plan。
2. 不得发明与输入冲突的事实。
3. 不得提前泄露 reveal schedule 中 forbidden 的真相。
4. 不得让角色知道其 knowledge 中不存在、且未在当前场景获得的信息。
5. 如果要求输出 JSON，只输出合法 JSON，不要 markdown code fence，不要解释。
6. 如果要求输出 Markdown，只输出正文内容，不要额外解释工程过程。
7. 你可以提出创造性方案，但必须服务于章节任务和长期叙事结构。
```

## 4. `strategy.build_story_bible`

输入：brief.md  
输出：Markdown

```text
任务：根据用户 brief 生成一份可长期约束小说创作的 Story Bible。

要求包含以下部分：

# Story Bible

## 1. 小说定位
- 类型
- 子类型
- 目标读者
- 核心卖点
- 一句话 logline

## 2. 读者承诺
- 本书承诺给读者的主要体验
- 每 3-5 章应出现的阅读回报
- 禁止破坏的期待

## 3. 主角设计
- 姓名/身份
- 外在目标
- 内在欲望
- 核心缺陷
- 恐惧
- 初始状态
- 目标终局状态

## 4. 主要角色
每个角色包含：功能、欲望、秘密、与主角关系、潜在变化。

## 5. 世界观规则
列出硬规则和软规则。硬规则后续不能随意违反。

## 6. 主线冲突
说明全书外部冲突、内部冲突、关系冲突、主题冲突。

## 7. 长期人物弧光
说明主要角色从起点到终点的变化。

## 8. 叙事视角和风格
说明 POV、语言质感、节奏要求、禁忌表达。

## 9. 不允许事项
列出容易导致作品崩坏的禁区。

<brief>
{{BRIEF}}
</brief>
```

## 5. `planning.plan_chapter_mission`

输出：JSON，必须符合 ChapterMissionSchema。

```text
任务：为指定章节生成 Chapter Mission。不要写正文。

你要根据当前 Story State、Story Bible、全书/分卷大纲、当前章节编号，判断本章必须完成什么叙事任务。

重点考虑：
1. 哪些 narrative debts 已经过期或即将到期。
2. 哪些角色弧光需要推进。
3. 本章应该给读者什么信息增量。
4. 本章应该维持、升级、偿还或新增哪些悬念。
5. 本章不能提前泄露什么。
6. 本章要满足什么类型文期待。

只输出 JSON。

<story_bible>
{{STORY_BIBLE}}
</story_bible>

<global_outline>
{{GLOBAL_OUTLINE}}
</global_outline>

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<required_schema_summary>
{{CHAPTER_MISSION_SCHEMA_SUMMARY}}
</required_schema_summary>
```

## 6. `planning.generate_plan_candidates`

输出：JSON。

```text
任务：基于 Chapter Mission 生成 {{CANDIDATE_COUNT}} 个不同的章节方案。不要写正文。

每个方案必须包含：
- candidateId
- title
- coreIdea
- plotBeats
- debtMoves
- characterMoves
- readerEffect
- majorRisk
- whyThisWorks

方案之间必须有明显差异，例如：
- 一个偏悬疑推进
- 一个偏人物关系推进
- 一个偏动作/冲突推进

不得违反 forbiddenMoves。

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<genre_contract>
{{GENRE_CONTRACT}}
</genre_contract>

只输出 JSON，格式：
{
  "chapterNumber": 1,
  "candidates": [ ... ]
}
```

## 7. `planning.rank_plan_candidates`

输出：JSON。

```text
任务：评估并排序章节候选方案。不要写正文，不要生成新方案。

评分维度，每项 0-10：
- plotProgression
- characterArc
- debtManagement
- readerCuriosity
- tensionCurve
- genreSatisfaction
- continuityRisk，其中分数越高表示风险越低
- overall

选择 overall 最高且没有硬性冲突的方案。

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<plan_candidates_json>
{{PLAN_CANDIDATES_JSON}}
</plan_candidates_json>

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

只输出 JSON，格式：
{
  "chapterNumber": 1,
  "rankings": [
    {
      "candidateId": "plan_001",
      "scores": {},
      "strengths": [],
      "risks": [],
      "requiredAdjustments": []
    }
  ],
  "selectedCandidateId": "plan_001",
  "selectionReason": "..."
}
```

## 8. `planning.generate_scene_cards`

输出：JSON，必须符合 SceneCardSchema 数组。

```text
任务：把选中的章节方案拆成场景卡。不要写正文。

每个场景必须有明确叙事功能，不能只是过场。

场景卡必须覆盖：
- POV
- 地点
- 时间
- 入场状态
- 场景冲突
- 主要 beats
- 信息增量
- 人物状态变化
- 读者效果
- 退出钩子
- 约束

<selected_plan>
{{SELECTED_PLAN}}
</selected_plan>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

只输出 JSON，格式：
{
  "chapterNumber": 1,
  "sceneCards": [ ... ]
}
```

## 9. `production.write_scene`

输出：Markdown。

```text
任务：根据 Scene Card 写出单个场景正文。

要求：
1. 只写当前场景，不要写其他场景。
2. 严格遵守 POV、时间、地点、角色知识限制。
3. 必须完成 scene card 中的信息增量、人物变化和 exit hook。
4. 不得解释工程过程。
5. 不得提前泄露 forbidden reveals。
6. 语言风格遵守 style guide。
7. 场景必须有可感知的冲突、推进和转折。

<style_guide>
{{STYLE_GUIDE}}
</style_guide>

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<scene_card_json>
{{SCENE_CARD_JSON}}
</scene_card_json>

<previous_scene_summary>
{{PREVIOUS_SCENE_SUMMARY}}
</previous_scene_summary>
```

## 10. `production.assemble_chapter`

输出：Markdown。

```text
任务：把多个场景草稿组装成一章完整草稿。

你可以做轻微转场、衔接和节奏修复，但不能新增重大剧情事实。

要求：
1. 保留各场景核心事件。
2. 删除重复表达。
3. 统一语气和节奏。
4. 保证章节结尾有钩子。
5. 不得改变 Story State 中的既有 canon。

<style_guide>
{{STYLE_GUIDE}}
</style_guide>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<scene_drafts>
{{SCENE_DRAFTS}}
</scene_drafts>
```

## 11. `diagnostics.diagnose_chapter`

输出：JSON，必须符合 DiagnosticsReportSchema。

```text
任务：诊断章节草稿。不要重写，不要续写。

硬检查：
1. 时间线是否矛盾。
2. 角色是否知道了不该知道的信息。
3. 是否违反世界观硬规则。
4. 是否提前泄露 forbidden reveal。
5. 是否违反 Chapter Mission 的 forbiddenMoves。
6. 是否没有完成 must objectives。

软评分：
- plotProgression
- characterConsistency
- tensionCurve
- emotionalImpact
- hookStrength
- styleMatch
- genreSatisfaction
- readerCuriosity
- proseQuality

输出必须包含证据和具体修改建议。

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<style_guide>
{{STYLE_GUIDE}}
</style_guide>

<draft>
{{DRAFT}}
</draft>

只输出 JSON。
```

## 12. `revision.create_revision_plan`

输出：JSON，必须符合 RevisionPlanSchema。

```text
任务：根据 DiagnosticsReport 生成可执行修订计划。不要直接重写正文。

修订计划必须具体到目标区域和操作类型。

优先选择最小可行修改：
1. 能局部修就不要整章重写。
2. 能重写单场景就不要重写整章。
3. 硬失败优先于软评分。
4. 修复信息泄露时优先删除或改写泄露句。
5. 修复人物动机时必须说明角色当下可用的信息和心理状态。

<diagnostics_json>
{{DIAGNOSTICS_JSON}}
</diagnostics_json>

<draft>
{{DRAFT}}
</draft>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

只输出 JSON。
```

## 13. `revision.revise_draft`

输出：Markdown。

```text
任务：根据 Revision Plan 修改章节草稿。

要求：
1. 只执行 Revision Plan 中列出的操作。
2. 不新增未授权重大设定。
3. 保持已通过部分尽量不变。
4. 修复硬失败。
5. 提升软评分最低的 1-3 项。
6. 输出完整修订后章节，不要输出修改说明。

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<chapter_mission_json>
{{CHAPTER_MISSION_JSON}}
</chapter_mission_json>

<revision_plan_json>
{{REVISION_PLAN_JSON}}
</revision_plan_json>

<draft>
{{DRAFT}}
</draft>
```

## 14. `memory.extract_canon_patch`

输出：JSON，必须符合 CanonPatchSchema。

```text
任务：从最终章节中抽取 Canon Patch。

规则：
1. 只抽取最终章节中已经明确发生、明确被读者知道、明确被角色知道、或明确改变的内容。
2. 不要把推测当作事实。
3. 不要新增未在正文出现的设定。
4. 区分 reader knows、reader suspects、reader questions。
5. 区分角色知道、怀疑、误解。
6. 对叙事债务要判断 create、maintain、escalate、partially_pay、pay、cancel。
7. 对伏笔要判断 create、reinforce、pay、abandon。

<story_state_json>
{{STORY_STATE_JSON}}
</story_state_json>

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<final_chapter>
{{FINAL_CHAPTER}}
</final_chapter>

只输出 JSON。
```

## 15. `memory.repair_json_output`

输出：JSON。

```text
任务：修复上一个模型输出，使其成为合法 JSON，并尽可能符合目标 schema。

禁止：
- 不要新增实质性内容。
- 不要改变语义。
- 不要输出 markdown code fence。
- 不要解释。

<target_schema_summary>
{{SCHEMA_SUMMARY}}
</target_schema_summary>

<invalid_output>
{{INVALID_OUTPUT}}
</invalid_output>
```

## 16. 温度建议

| 模块 | temperature |
|---|---:|
| Story Bible | 0.6 |
| Global Outline | 0.65 |
| Chapter Mission | 0.4 |
| Plan Candidates | 0.75 |
| Ranking | 0.2 |
| Scene Cards | 0.55 |
| Scene Writing | 0.85 |
| Diagnostics | 0.2 |
| Revision Plan | 0.25 |
| Revise Draft | 0.45 |
| Canon Patch | 0.15 |
| JSON Repair | 0.0 |

## 17. Prompt 测试要求

每个 JSON prompt 必须有至少两个 fixture：

1. 正常输出。
2. 含边界情况的输出，例如已有 overdue debt、禁止 reveal、多角色知识差异。

每个 Markdown prompt 必须有至少一个 snapshot 测试，确保 mock mode 能跑通完整流程。
