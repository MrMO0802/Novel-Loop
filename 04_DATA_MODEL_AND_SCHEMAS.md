# 数据模型与 Schema 说明：Novel Loop Engine

## 1. 设计原则

1. 结构化状态与正文分离。
2. 已确认事实必须有来源章节。
3. 角色知道的信息、读者知道的信息、作者知道的真相必须分离。
4. 伏笔和叙事债务必须有生命周期。
5. 所有 ID 稳定、可引用、可追踪。
6. 所有 JSON 必须通过 schema 校验。

## 2. ID 命名规范

| 类型 | 示例 |
|---|---|
| canon fact | `fact_0001` |
| character | `char_lincheng` 或 `char_0001` |
| narrative debt | `debt_0001` |
| foreshadowing | `fs_0001` |
| plot thread | `thread_0001` |
| timeline event | `event_0001` |
| reveal | `reveal_0001` |
| chapter mission | `mission_ch001` |
| scene | `scene_ch001_001` |

## 3. StoryState 顶层结构

```ts
export const StoryStateSchema = z.object({
  schemaVersion: z.literal('1.0'),
  projectId: z.string(),
  language: z.string().default('zh-CN'),
  latestCommittedChapter: z.number().int().nonnegative(),
  canonFacts: z.array(CanonFactSchema),
  characters: z.array(CharacterStateSchema),
  worldRules: z.array(WorldRuleSchema),
  timeline: z.array(TimelineEventSchema),
  plotThreads: z.array(PlotThreadSchema),
  narrativeDebts: z.array(NarrativeDebtSchema),
  foreshadowing: z.array(ForeshadowingSchema),
  readerState: ReaderStateSchema,
  relationshipGraph: RelationshipGraphSchema,
  revealSchedule: z.array(RevealPlanSchema),
  updatedAt: z.string()
});
```

示例：

```json
{
  "schemaVersion": "1.0",
  "projectId": "demo-novel",
  "language": "zh-CN",
  "latestCommittedChapter": 1,
  "canonFacts": [],
  "characters": [],
  "worldRules": [],
  "timeline": [],
  "plotThreads": [],
  "narrativeDebts": [],
  "foreshadowing": [],
  "readerState": {
    "readerKnows": [],
    "readerSuspects": [],
    "readerQuestions": [],
    "readerExpectations": [],
    "readerDoesNotKnow": []
  },
  "relationshipGraph": {
    "nodes": [],
    "edges": []
  },
  "revealSchedule": [],
  "updatedAt": "2026-07-02T00:00:00.000Z"
}
```

## 4. CanonFact

CanonFact 表示已经在最终正文中确认发生或成立的事实。

```ts
export const CanonFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceChapter: z.number().int().positive(),
  sourceSceneId: z.string().optional(),
  type: z.enum(['event', 'character', 'world', 'relationship', 'object', 'mystery', 'theme']),
  visibility: z.object({
    reader: z.boolean(),
    author: z.boolean().default(true),
    characters: z.record(z.string(), z.boolean()).default({})
  }),
  confidence: z.enum(['explicit', 'strongly_implied', 'weakly_implied']).default('explicit'),
  createdAt: z.string()
});
```

示例：

```json
{
  "id": "fact_0001",
  "text": "林澈在旧货市场买到一台会在夜晚发出求救声的旧收音机。",
  "sourceChapter": 1,
  "sourceSceneId": "scene_ch001_003",
  "type": "event",
  "visibility": {
    "reader": true,
    "author": true,
    "characters": {
      "char_lincheng": true,
      "char_xuwei": false
    }
  },
  "confidence": "explicit",
  "createdAt": "2026-07-02T00:00:00.000Z"
}
```

## 5. CharacterState

```ts
export const CharacterStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'deuteragonist', 'antagonist', 'supporting', 'minor']),
  age: z.number().int().positive().optional(),
  publicDescription: z.string(),
  privateTruths: z.array(z.string()).default([]),
  personality: z.array(z.string()).default([]),
  desire: z.string().optional(),
  fear: z.string().optional(),
  flaw: z.string().optional(),
  currentGoal: z.string().optional(),
  emotionalState: z.string().optional(),
  physicalState: z.string().optional(),
  knowledge: z.array(z.object({
    factId: z.string().optional(),
    text: z.string(),
    status: z.enum(['knows', 'believes', 'suspects', 'misunderstands']),
    learnedInChapter: z.number().int().positive().optional()
  })).default([]),
  arc: z.object({
    startingPoint: z.string().optional(),
    currentStage: z.string().optional(),
    targetEndState: z.string().optional()
  }).default({}),
  constraints: z.array(z.string()).default([]),
  lastUpdatedChapter: z.number().int().nonnegative().default(0)
});
```

## 6. WorldRule

```ts
export const WorldRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  rule: z.string(),
  exceptions: z.array(z.string()).default([]),
  source: z.enum(['bible', 'chapter', 'editor']),
  sourceChapter: z.number().int().positive().optional(),
  strictness: z.enum(['hard', 'soft']),
  status: z.enum(['active', 'deprecated']).default('active')
});
```

## 7. NarrativeDebt

NarrativeDebt 是作品对读者建立的承诺。它可能是谜题、情感关系、爽点、复仇、升级、主题问题或人物缺陷的解决。

```ts
export const NarrativeDebtSchema = z.object({
  id: z.string(),
  type: z.enum(['mystery', 'character', 'relationship', 'power', 'revenge', 'theme', 'world', 'promise']),
  promise: z.string(),
  readerQuestion: z.string(),
  introducedInChapter: z.number().int().positive(),
  introducedInSceneId: z.string().optional(),
  status: z.enum(['open', 'partially_paid', 'paid', 'cancelled']),
  importance: z.number().min(1).max(10),
  urgency: z.number().min(1).max(10),
  payoffTargetChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string()).default([]),
  relatedThreads: z.array(z.string()).default([]),
  payoffHistory: z.array(z.object({
    chapter: z.number().int().positive(),
    text: z.string(),
    effect: z.enum(['maintained', 'escalated', 'partially_paid', 'paid'])
  })).default([])
});
```

示例：

```json
{
  "id": "debt_0001",
  "type": "mystery",
  "promise": "17 楼隐藏着异常收音机求救声的关键线索。",
  "readerQuestion": "17 楼到底发生了什么？",
  "introducedInChapter": 1,
  "introducedInSceneId": "scene_ch001_004",
  "status": "open",
  "importance": 9,
  "urgency": 8,
  "payoffTargetChapter": 5,
  "relatedCharacters": ["char_lincheng"],
  "relatedThreads": ["thread_0001"],
  "payoffHistory": []
}
```

## 8. Foreshadowing

```ts
export const ForeshadowingSchema = z.object({
  id: z.string(),
  surfaceDetail: z.string(),
  hiddenMeaning: z.string(),
  introducedInChapter: z.number().int().positive(),
  payoffTargetChapter: z.number().int().positive().optional(),
  status: z.enum(['unresolved', 'reinforced', 'paid', 'abandoned']),
  subtlety: z.enum(['obvious', 'medium', 'subtle']),
  relatedDebtId: z.string().optional(),
  payoffText: z.string().optional()
});
```

## 9. ReaderState

ReaderState 描述读者当前信息状态。它用于防止提前泄露、控制悬念和设计期待。

```ts
export const ReaderStateSchema = z.object({
  readerKnows: z.array(z.string()).default([]),
  readerSuspects: z.array(z.string()).default([]),
  readerQuestions: z.array(z.string()).default([]),
  readerExpectations: z.array(z.string()).default([]),
  readerDoesNotKnow: z.array(z.string()).default([])
});
```

## 10. RevealPlan

```ts
export const RevealPlanSchema = z.object({
  id: z.string(),
  truth: z.string(),
  currentStage: z.enum(['hidden', 'hinted', 'suspected', 'partially_revealed', 'revealed']),
  plannedRevealWindow: z.object({
    startChapter: z.number().int().positive(),
    endChapter: z.number().int().positive()
  }),
  forbiddenBeforeChapter: z.number().int().positive().optional(),
  relatedCharacters: z.array(z.string()).default([]),
  relatedDebts: z.array(z.string()).default([])
});
```

## 11. ChapterMission

```ts
export const ChapterMissionSchema = z.object({
  id: z.string(),
  chapterNumber: z.number().int().positive(),
  chapterFunction: z.string(),
  requiredObjectives: z.array(z.object({
    id: z.string(),
    text: z.string(),
    type: z.enum(['plot', 'character', 'relationship', 'world', 'debt', 'foreshadowing', 'reader']),
    priority: z.enum(['must', 'should', 'could'])
  })),
  debtsToPayOrAdvance: z.array(z.string()).default([]),
  debtsToIntroduce: z.array(z.object({
    type: z.string(),
    promise: z.string(),
    importance: z.number().min(1).max(10)
  })).default([]),
  characterDeltas: z.array(z.object({
    characterId: z.string(),
    from: z.string(),
    to: z.string(),
    evidenceRequired: z.string()
  })).default([]),
  readerInformationDelta: z.object({
    newKnowledge: z.array(z.string()).default([]),
    newSuspicions: z.array(z.string()).default([]),
    questionsToMaintain: z.array(z.string()).default([]),
    questionsToAnswer: z.array(z.string()).default([])
  }),
  forbiddenMoves: z.array(z.string()).default([]),
  targetEmotionalCurve: z.array(z.string()).default([]),
  targetWordCount: z.number().int().positive().optional()
});
```

## 12. SceneCard

```ts
export const SceneCardSchema = z.object({
  id: z.string(),
  chapterNumber: z.number().int().positive(),
  order: z.number().int().positive(),
  title: z.string().optional(),
  povCharacterId: z.string(),
  location: z.string(),
  time: z.string(),
  entryState: z.string(),
  conflict: z.string(),
  beats: z.array(z.string()).min(1),
  informationDelta: z.array(z.string()).default([]),
  characterDelta: z.array(z.object({
    characterId: z.string(),
    change: z.string()
  })).default([]),
  readerEffect: z.string(),
  exitHook: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  targetWordCount: z.number().int().positive().optional()
});
```

## 13. DiagnosticsReport

```ts
export const DiagnosticsReportSchema = z.object({
  chapterNumber: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  hardFailures: z.array(z.object({
    code: z.string(),
    severity: z.enum(['critical', 'high']),
    message: z.string(),
    evidence: z.string().optional(),
    suggestedFix: z.string().optional()
  })).default([]),
  scores: z.object({
    total: z.number().min(0).max(10),
    plotProgression: z.number().min(0).max(10),
    characterConsistency: z.number().min(0).max(10),
    tensionCurve: z.number().min(0).max(10),
    emotionalImpact: z.number().min(0).max(10),
    hookStrength: z.number().min(0).max(10),
    styleMatch: z.number().min(0).max(10),
    genreSatisfaction: z.number().min(0).max(10),
    readerCuriosity: z.number().min(0).max(10),
    proseQuality: z.number().min(0).max(10)
  }),
  missionSatisfaction: z.object({
    allRequiredSatisfied: z.boolean(),
    objectiveResults: z.array(z.object({
      objectiveId: z.string(),
      satisfied: z.boolean(),
      evidence: z.string().optional(),
      issue: z.string().optional()
    }))
  }),
  issues: z.array(z.object({
    type: z.enum(['timeline', 'character', 'knowledge', 'world_rule', 'pacing', 'style', 'hook', 'debt', 'reveal', 'prose']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    message: z.string(),
    locationHint: z.string().optional(),
    recommendation: z.string().optional()
  })).default([])
});
```

## 14. RevisionPlan

```ts
export const RevisionPlanSchema = z.object({
  chapterNumber: z.number().int().positive(),
  fromDraftVersion: z.number().int().positive(),
  strategy: z.enum([
    'local_patch',
    'rewrite_scene',
    'reorder_scenes',
    'strengthen_hook',
    'reduce_exposition',
    'fix_character_motivation',
    'delay_reveal',
    'payoff_debt',
    'full_chapter_rewrite',
    'human_review'
  ]),
  operations: z.array(z.object({
    target: z.string(),
    operation: z.string(),
    reason: z.string(),
    instruction: z.string(),
    expectedEffect: z.string().optional()
  })),
  riskNotes: z.array(z.string()).default([])
});
```

## 15. CanonPatch

```ts
export const CanonPatchSchema = z.object({
  chapterNumber: z.number().int().positive(),
  sourceFinalPath: z.string(),
  newFacts: z.array(CanonFactSchema).default([]),
  characterUpdates: z.array(z.object({
    characterId: z.string(),
    field: z.string(),
    oldValueSummary: z.string().optional(),
    newValue: z.unknown(),
    reason: z.string()
  })).default([]),
  timelineEvents: z.array(TimelineEventSchema).default([]),
  narrativeDebtUpdates: z.array(z.object({
    debtId: z.string().optional(),
    action: z.enum(['create', 'maintain', 'escalate', 'partially_pay', 'pay', 'cancel']),
    payload: z.unknown()
  })).default([]),
  foreshadowingUpdates: z.array(z.object({
    foreshadowingId: z.string().optional(),
    action: z.enum(['create', 'reinforce', 'pay', 'abandon']),
    payload: z.unknown()
  })).default([]),
  readerStatePatch: z.object({
    addKnows: z.array(z.string()).default([]),
    addSuspects: z.array(z.string()).default([]),
    addQuestions: z.array(z.string()).default([]),
    removeQuestions: z.array(z.string()).default([]),
    addExpectations: z.array(z.string()).default([]),
    addDoesNotKnow: z.array(z.string()).default([])
  }).default({}),
  relationshipUpdates: z.array(z.object({
    fromCharacterId: z.string(),
    toCharacterId: z.string(),
    change: z.string(),
    evidence: z.string()
  })).default([]),
  revealScheduleUpdates: z.array(z.object({
    revealId: z.string().optional(),
    action: z.enum(['create', 'advance_stage', 'mark_revealed', 'delay']),
    payload: z.unknown()
  })).default([])
});
```

## 16. Patch 冲突规则

Apply CanonPatch 时必须检测：

1. 关闭不存在的 debt。
2. 回收不存在的 foreshadowing。
3. 设置 payoff chapter 小于 introduced chapter。
4. 角色获得 forbidden reveal 前的信息。
5. 重复创建相同 ID。
6. 修改 hard world rule 却没有 editor override。
7. 时间线事件发生顺序与已有事件冲突。

冲突处理：

- P0：拒绝 commit，进入 human review。
- P1：写 warning，但允许 commit，需要配置。

## 17. 最小初始状态文件

`state/story_state.json` 初始值应为空数组但结构完整。不要缺字段。

```json
{
  "schemaVersion": "1.0",
  "projectId": "demo-novel",
  "language": "zh-CN",
  "latestCommittedChapter": 0,
  "canonFacts": [],
  "characters": [],
  "worldRules": [],
  "timeline": [],
  "plotThreads": [],
  "narrativeDebts": [],
  "foreshadowing": [],
  "readerState": {
    "readerKnows": [],
    "readerSuspects": [],
    "readerQuestions": [],
    "readerExpectations": [],
    "readerDoesNotKnow": []
  },
  "relationshipGraph": {
    "nodes": [],
    "edges": []
  },
  "revealSchedule": [],
  "updatedAt": "2026-07-02T00:00:00.000Z"
}
```
