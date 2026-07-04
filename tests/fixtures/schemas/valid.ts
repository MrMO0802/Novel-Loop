export const validConfig = {
  projectId: 'demo-novel',
  language: 'zh-CN',
  defaultProvider: 'mock',
  qualityThreshold: 8.2,
  chapter: {
    defaultCandidateCount: 3,
    maxRevisionAttempts: 3,
    targetWordCount: 3500,
    sceneMinCount: 3,
    sceneMaxCount: 8
  },
  llm: {
    temperature: {
      planning: 0.6,
      writing: 0.85,
      diagnostics: 0.2,
      revision: 0.45
    }
  },
  storage: {
    snapshotOnCommit: true,
    atomicWrites: true
  }
};

export const validReaderState = {
  readerKnows: ['林澈买到了旧收音机'],
  readerSuspects: ['收音机和失踪案有关'],
  readerQuestions: ['17 楼到底发生了什么？'],
  readerExpectations: ['林澈会继续调查'],
  readerDoesNotKnow: ['旧收音机真正来源']
};

export const validCharacterState = {
  id: 'char_lincheng',
  name: '林澈',
  role: 'protagonist',
  age: 24,
  publicDescription: '外卖员，观察力强但习惯逃避冲突。',
  privateTruths: ['母亲失踪案和异常物品有关'],
  personality: ['克制', '敏锐', '逃避麻烦'],
  desire: '过上平静但有尊严的生活',
  fear: '再次被卷入无法控制的事件',
  flaw: '遇到冲突时先退缩',
  currentGoal: '查清旧收音机的求救声来源',
  emotionalState: '警觉',
  physicalState: '疲惫',
  knowledge: [
    {
      factId: 'fact_0001',
      text: '旧收音机会在夜晚播放求救声',
      status: 'knows',
      learnedInChapter: 1
    }
  ],
  arc: {
    startingPoint: '被动逃避',
    currentStage: '被迫面对异常',
    targetEndState: '主动追查真相'
  },
  constraints: ['不能开局无敌'],
  lastUpdatedChapter: 1
};

export const validNarrativeDebt = {
  id: 'debt_0001',
  type: 'mystery',
  promise: '17 楼隐藏着异常收音机求救声的关键线索。',
  readerQuestion: '17 楼到底发生了什么？',
  introducedInChapter: 1,
  introducedInSceneId: 'scene_ch001_004',
  status: 'open',
  importance: 9,
  urgency: 8,
  payoffTargetChapter: 5,
  relatedCharacters: ['char_lincheng'],
  relatedThreads: ['thread_0001'],
  payoffHistory: [
    {
      chapter: 2,
      text: '林澈听到第二段求救声。',
      effect: 'escalated'
    }
  ]
};

export const validForeshadowing = {
  id: 'fs_0001',
  surfaceDetail: '旧收音机旋钮上有被刮掉的楼层数字。',
  hiddenMeaning: '数字指向失踪案发生的 17 楼。',
  introducedInChapter: 1,
  payoffTargetChapter: 5,
  status: 'unresolved',
  subtlety: 'medium',
  relatedDebtId: 'debt_0001'
};

export const validStoryState = {
  schemaVersion: '1.0',
  projectId: 'demo-novel',
  language: 'zh-CN',
  latestCommittedChapter: 1,
  canonFacts: [
    {
      id: 'fact_0001',
      text: '林澈在旧货市场买到一台会在夜晚发出求救声的旧收音机。',
      sourceChapter: 1,
      sourceSceneId: 'scene_ch001_003',
      type: 'event',
      visibility: {
        reader: true,
        author: true,
        characters: {
          char_lincheng: true
        }
      },
      confidence: 'explicit',
      createdAt: '2026-07-02T00:00:00.000Z'
    }
  ],
  characters: [validCharacterState],
  worldRules: [
    {
      id: 'rule_0001',
      name: '异常物品低可见性',
      rule: '异常物品的能力必须通过细节逐步显现。',
      exceptions: [],
      source: 'bible',
      strictness: 'hard',
      status: 'active'
    }
  ],
  timeline: [
    {
      id: 'event_0001',
      chapter: 1,
      sceneId: 'scene_ch001_003',
      order: 1,
      summary: '林澈买到旧收音机。',
      participants: ['char_lincheng'],
      location: '旧货市场',
      timestampLabel: '第一章傍晚'
    }
  ],
  plotThreads: [
    {
      id: 'thread_0001',
      name: '旧收音机求救声',
      status: 'active',
      summary: '林澈追查旧收音机中的求救声。',
      relatedCharacters: ['char_lincheng'],
      relatedDebts: ['debt_0001']
    }
  ],
  narrativeDebts: [validNarrativeDebt],
  foreshadowing: [validForeshadowing],
  readerState: validReaderState,
  relationshipGraph: {
    nodes: [
      {
        characterId: 'char_lincheng',
        label: '林澈'
      }
    ],
    edges: [
      {
        fromCharacterId: 'char_lincheng',
        toCharacterId: 'char_xuwei',
        relationship: '陌生但互相试探',
        status: 'tense',
        evidence: '第一章中许薇没有完全信任林澈。'
      }
    ]
  },
  revealSchedule: [
    {
      id: 'reveal_0001',
      truth: '旧收音机与林澈母亲失踪案有关。',
      currentStage: 'hidden',
      plannedRevealWindow: {
        startChapter: 8,
        endChapter: 12
      },
      forbiddenBeforeChapter: 8,
      relatedCharacters: ['char_lincheng'],
      relatedDebts: ['debt_0001']
    }
  ],
  updatedAt: '2026-07-02T00:00:00.000Z'
};

export const validChapterMission = {
  id: 'mission_ch001',
  chapterNumber: 1,
  chapterFunction: '让主角被动卷入异常事件，并建立核心谜题。',
  requiredObjectives: [
    {
      id: 'obj_001',
      text: '展示林澈逃避冲突但观察力强的性格。',
      type: 'character',
      priority: 'must'
    }
  ],
  debtsToPayOrAdvance: ['debt_0001'],
  debtsToIntroduce: [
    {
      type: 'mystery',
      promise: '旧收音机的求救声不是普通录音。',
      importance: 9
    }
  ],
  characterDeltas: [
    {
      characterId: 'char_lincheng',
      from: '逃避麻烦',
      to: '被迫追查',
      evidenceRequired: '他主动保留旧收音机'
    }
  ],
  readerInformationDelta: {
    newKnowledge: ['旧收音机会在夜晚播放求救声'],
    newSuspicions: ['求救声来自失踪者'],
    questionsToMaintain: ['17 楼发生过什么？'],
    questionsToAnswer: []
  },
  forbiddenMoves: ['不要解释完整组织设定'],
  targetEmotionalCurve: ['日常', '不安', '惊疑'],
  targetWordCount: 3500
};

export const validSceneCard = {
  sceneId: 'scene_001',
  id: 'scene_ch001_001',
  chapterNumber: 1,
  order: 1,
  title: '旧货市场',
  purpose: '让林澈从日常疲惫进入旧收音机异常事件。',
  povCharacterId: 'char_lincheng',
  location: '旧货市场',
  time: '傍晚',
  entryState: '林澈下班后想尽快回家。',
  conflict: '摊主试图把旧收音机强卖给他。',
  entryPoint: '林澈在旧货市场绕路避雨。',
  exitPoint: '他带走旧收音机，并发现它在没有电池时短暂亮灯。',
  characters: ['char_lincheng', 'char_vendor'],
  beats: ['林澈注意到收音机旋钮异常', '摊主急着脱手', '林澈低价买下'],
  informationDelta: ['旧收音机来历不明'],
  emotionalShift: '疲惫克制 -> 隐约不安',
  characterDelta: [
    {
      characterId: 'char_lincheng',
      change: '从想离开到被细节吸引'
    }
  ],
  readerEffect: '建立不安感和核心物件。',
  exitHook: '收音机在没有电池时亮了一下。',
  constraints: ['不要解释收音机来源'],
  targetWordCount: 900
};

export const validDiagnosticsReport = {
  chapterNumber: 1,
  draftVersion: 1,
  hard_checks: {
    timeline_consistency: {
      passed: true,
      message: '时间线顺序清晰。'
    },
    character_knowledge_consistency: {
      passed: true,
      message: '角色没有使用未知信息。'
    },
    world_rule_consistency: {
      passed: true,
      message: '异常物品低可见性规则保持一致。'
    },
    no_unplanned_reveal: {
      passed: true,
      message: '没有提前揭示保密设定。'
    }
  },
  soft_scores: {
    plot_progression: 8,
    character_consistency: 9,
    tension_curve: 8,
    emotional_impact: 8,
    chapter_hook: 9,
    style_match: 8,
    genre_satisfaction: 8,
    reader_curiosity: 9
  },
  hardFailures: [],
  scores: {
    total: 8.4,
    plotProgression: 8,
    characterConsistency: 9,
    tensionCurve: 8,
    emotionalImpact: 8,
    hookStrength: 9,
    styleMatch: 8,
    genreSatisfaction: 8,
    readerCuriosity: 9,
    proseQuality: 8
  },
  missionSatisfaction: {
    allRequiredSatisfied: true,
    objectiveResults: [
      {
        objectiveId: 'obj_001',
        satisfied: true,
        evidence: '林澈通过观察旋钮异常推动情节。'
      }
    ]
  },
  issues: [
    {
      type: 'pacing',
      severity: 'low',
      message: '中段解释略多。',
      locationHint: 'scene_ch001_002',
      recommendation: '减少背景说明。'
    }
  ]
};

export const validRevisionPlan = {
  chapterNumber: 1,
  fromDraftVersion: 1,
  revision_strategy: 'reduce_exposition',
  strategy: 'reduce_exposition',
  operations: [
    {
      target: {
        type: 'scene',
        sceneId: 'scene_002'
      },
      operation: 'delete_or_compress_exposition',
      reason: '解释性段落削弱悬疑节奏。',
      concrete_instruction: '压缩关于旧货市场历史的说明，只保留能制造异常感的细节。',
      instruction: '压缩关于旧货市场历史的说明，只保留能制造异常感的细节。',
      expectedEffect: '提高节奏和悬念。'
    }
  ],
  riskNotes: ['不要删除旧收音机的关键视觉线索。']
};

export const validCanonPatch = {
  chapterNumber: 1,
  sourceFinalPath: 'chapters/chapter_001/final.md',
  latestCommittedChapter: 1,
  newFacts: validStoryState.canonFacts,
  characterStates: [validCharacterState],
  characterUpdates: [
    {
      characterId: 'char_lincheng',
      field: 'currentGoal',
      oldValueSummary: '想回避麻烦',
      newValue: '查清旧收音机求救声来源',
      reason: '最终章结尾林澈决定保留收音机。'
    }
  ],
  timelineEvents: validStoryState.timeline,
  narrativeDebtUpdates: [
    {
      debtId: 'debt_0001',
      action: 'escalate',
      payload: {
        payoffTargetChapter: 5
      }
    }
  ],
  foreshadowingUpdates: [
    {
      foreshadowingId: 'fs_0001',
      action: 'reinforce',
      payload: {
        surfaceDetail: '旋钮刮痕再次出现'
      }
    }
  ],
  readerStatePatch: {
    addKnows: ['旧收音机没有电池也会亮'],
    addSuspects: ['求救声不是普通录音'],
    addQuestions: ['旧收音机来自哪里？'],
    removeQuestions: [],
    addExpectations: ['林澈会追查旧收音机'],
    addDoesNotKnow: ['收音机与母亲失踪案的关系']
  },
  relationshipUpdates: [
    {
      fromCharacterId: 'char_lincheng',
      toCharacterId: 'char_xuwei',
      change: '从陌生到初步警惕',
      evidence: '许薇注意到林澈隐瞒了收音机细节。'
    }
  ],
  revealScheduleUpdates: [
    {
      revealId: 'reveal_0001',
      action: 'advance_stage',
      payload: {
        currentStage: 'hinted'
      }
    }
  ]
};
