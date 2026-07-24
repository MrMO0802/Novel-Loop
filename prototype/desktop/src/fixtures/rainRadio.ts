export type MysteryStatus = 'attention' | 'advancing' | 'open';
export type ForeshadowingStatus = 'planted' | 'returned';
export type ReaderKnowledgeKind = 'known' | 'suspected' | 'questioned' | 'expected';

export interface StoryCharacter {
  key: string;
  name: string;
  role: string;
  currentGoal: string;
  currentState: string;
  pressure: string;
  lastSeen: string;
}

export interface TimelineEvent {
  key: string;
  when: string;
  title: string;
  summary: string;
  source: string;
}

export interface ReaderKnowledgeGroup {
  kind: ReaderKnowledgeKind;
  items: readonly string[];
}

export interface OpenMystery {
  key: string;
  question: string;
  status: MysteryStatus;
  evidence: string;
  source: string;
  writingQuestion: string;
}

export interface ForeshadowingThread {
  key: string;
  clue: string;
  status: ForeshadowingStatus;
  placement: string;
  intendedPayoff: string;
  evidence: string;
}

export interface Relationship {
  key: string;
  people: string;
  relation: string;
  currentState: string;
}

export interface StoryFact {
  key: string;
  statement: string;
  source: string;
}

export interface PendingStoryRecordChange {
  category: string;
  change: string;
  evidence: string;
}

export interface RainRadioProject {
  title: string;
  volume: {
    name: string;
    currentChapter: number;
    plannedChapters: number;
    direction: string;
  };
  latestChapter: {
    number: number;
    title: string;
    status: string;
    summary: string;
  };
  characters: readonly StoryCharacter[];
  timeline: readonly TimelineEvent[];
  readerKnowledge: readonly ReaderKnowledgeGroup[];
  mysteries: readonly OpenMystery[];
  foreshadowing: readonly ForeshadowingThread[];
  relationships: readonly Relationship[];
  worldRules: readonly StoryFact[];
  canonFacts: readonly StoryFact[];
  pendingChanges: {
    chapter: string;
    status: string;
    note: string;
    changes: readonly PendingStoryRecordChange[];
  };
  recentActivity: readonly {
    key: string;
    when: string;
    title: string;
    detail: string;
  }[];
}

export const rainRadio: RainRadioProject = {
  title: '雨夜电台',
  volume: {
    name: '第一卷',
    currentChapter: 2,
    plannedChapters: 30,
    direction: '完成三次地址追踪，让每个眼前危机都把林澈带回姐姐失踪前的行动轨迹。'
  },
  latestChapter: {
    number: 2,
    title: '收件地址',
    status: '修订已通过章节检查，故事档案变更等待审阅',
    summary: '林澈按广播里的地址来到临江里三栋，却发现整栋楼的门牌都没有十七层。'
  },
  characters: [
    {
      key: 'lin-che',
      name: '林澈',
      role: '主角 · 外卖员',
      currentGoal: '调查广播信号，同时避免引起不必要的注意。',
      currentState: '确认无电收音机知道姐姐林遥的名字后，不再把广播当成偶然干扰。',
      pressure: '既想追查姐姐最后一单外卖，又害怕答案证明自己曾有机会阻止她失踪。',
      lastSeen: '第二章 · 临江里三栋门厅'
    },
    {
      key: 'lin-yao',
      name: '林遥',
      role: '林澈的姐姐 · 已失踪',
      currentGoal: '失踪前试图把一条无法留存的广播线索交给林澈。',
      currentState: '只通过旧配送记录、林澈的回忆和广播中的称呼出现。',
      pressure: '她失踪当晚的路线与正在拆迁的临江里重合。',
      lastSeen: '第一章回忆 · 三年前的雨夜'
    },
    {
      key: 'xu-wen',
      name: '许雯',
      role: '站点调度员',
      currentGoal: '帮林澈查清异常订单，同时不让站点经理发现。',
      currentState: '调出一张已经从系统撤回的旧订单截图。',
      pressure: '她认出了收件号码，却没有说明自己为什么记得。',
      lastSeen: '第二章 · 站点后门'
    }
  ],
  timeline: [
    {
      key: 'sister-last-delivery',
      when: '三年前 · 6 月 17 日 23:40',
      title: '林遥接下最后一单外卖',
      summary: '配送地址写着“临江里三栋十七层”，订单随后从站点记录中消失。',
      source: '第一章 · 林澈保存的旧截图'
    },
    {
      key: 'sister-disappears',
      when: '三年前 · 6 月 18 日凌晨',
      title: '林遥失踪',
      summary: '她的车停在沿江路口，保温箱和手机都留在车上。',
      source: '第一章 · 林澈回忆'
    },
    {
      key: 'radio-found',
      when: '现在 · 第一章 22:15',
      title: '林澈在废弃保温箱里发现收音机',
      summary: '收音机没有电池和电源线，外壳内侧刻着被刮花的“17”。',
      source: '第一章'
    },
    {
      key: 'first-broadcast',
      when: '现在 · 第一章 23:07',
      title: '第一次求救广播出现',
      summary: '雨声中传来一个女人的声音，请“林澈”把餐送到临江里三栋十七层。',
      source: '第一章'
    },
    {
      key: 'recording-fails',
      when: '现在 · 第一章 23:12',
      title: '手机录音没有留下人声',
      summary: '林澈回放录音时只能听见雨声，广播内容无法被普通设备保存。',
      source: '第一章'
    },
    {
      key: 'building-arrival',
      when: '现在 · 第二章 00:26',
      title: '林澈抵达临江里三栋',
      summary: '楼层按钮停在十六层，门厅值班表却有一笔写给“十七层”的夜间巡查。',
      source: '第二章 · 待正式提交'
    }
  ],
  readerKnowledge: [
    {
      kind: 'known',
      items: [
        '收音机没有电源，却会在雨夜播出。',
        '广播知道林澈的姓名，也指向林遥失踪前的最后配送地址。',
        '广播人声无法被普通录音设备保存。'
      ]
    },
    {
      kind: 'suspected',
      items: [
        '求救声可能与失踪的林遥有关。',
        '临江里并非第一次出现不存在的楼层记录。'
      ]
    },
    {
      kind: 'questioned',
      items: [
        '是谁撤回了林遥最后一单的站点记录？',
        '广播为什么只在下雨时出现？'
      ]
    },
    {
      kind: 'expected',
      items: [
        '林澈会进入临江里三栋继续寻找十七层。',
        '许雯隐瞒的收件号码来源会再次影响调查。'
      ]
    }
  ],
  mysteries: [
    {
      key: 'caller-knows-sister',
      question: '广播里的求救者为什么知道林澈姐姐的名字？',
      status: 'attention',
      evidence: '求救声先叫出“林澈”，随后说“你姐姐没有送到”。',
      source: '证据来自第一章',
      writingQuestion: '下一次广播应增加关联，但不要提前确认求救者身份。'
    },
    {
      key: 'floor-seventeen',
      question: '临江里三栋不存在的十七层在哪里？',
      status: 'advancing',
      evidence: '电梯只到十六层，值班表却记录了十七层夜间巡查。',
      source: '第一章已埋下地址，第二章正在推进',
      writingQuestion: '进入下一场景前，决定林澈先查楼梯还是值班人员。'
    },
    {
      key: 'withdrawn-order',
      question: '谁撤回了林遥最后一单外卖记录？',
      status: 'open',
      evidence: '林澈只留有截图，站点系统中已经查不到原订单。',
      source: '证据来自第一章',
      writingQuestion: '暂时保留操作权限的范围，不要把嫌疑集中到单一人物。'
    },
    {
      key: 'radio-origin',
      question: '没有电源的收音机从哪里来？',
      status: 'open',
      evidence: '收音机出现在一个停用三年的保温箱里，外壳刻着“17”。',
      source: '证据来自第一章',
      writingQuestion: '后续地址应重复一种可辨认的收音机痕迹。'
    }
  ],
  foreshadowing: [
    {
      key: 'scratched-seventeen',
      clue: '收音机外壳内侧被刮花的“17”',
      status: 'planted',
      placement: '第一章 · 林澈拆开电池盖时',
      intendedPayoff: '把收音机与不存在的十七层、姐姐最后一单连接起来。',
      evidence: '数字被刻在通常不会被看到的位置，像是特意留给拆机者。'
    },
    {
      key: 'xu-wen-number',
      clue: '许雯看见收件号码时停顿了两秒',
      status: 'planted',
      placement: '第二章 · 站点后门',
      intendedPayoff: '揭示许雯曾处理过同一号码发出的异常订单。',
      evidence: '她先说“不认识”，随后准确说出了号码归属的旧城区号段。'
    }
  ],
  relationships: [
    {
      key: 'lin-che-lin-yao',
      people: '林澈 ↔ 林遥',
      relation: '姐弟 · 失踪前关系疏远',
      currentState: '林澈用追查最后一单的方式弥补当年没有接听姐姐电话的愧疚。'
    },
    {
      key: 'lin-che-xu-wen',
      people: '林澈 ↔ 许雯',
      relation: '同事 · 有限互信',
      currentState: '许雯愿意协助查订单，但隐瞒了自己对收件号码的了解。'
    },
    {
      key: 'lin-yao-xu-wen',
      people: '林遥 ↔ 许雯',
      relation: '旧同事 · 关系尚未证实',
      currentState: '两人都接触过临江里订单，目前只有站点排班记录能把她们联系起来。'
    }
  ],
  worldRules: [
    {
      key: 'rain-only',
      statement: '收音机只在雨夜播出，雨停后立刻恢复静默。',
      source: '故事圣经'
    },
    {
      key: 'vanishing-address',
      statement: '每次广播都会说出一处即将消失的地址。',
      source: '故事圣经'
    },
    {
      key: 'cannot-record',
      statement: '广播中的人声无法被普通录音设备保存。',
      source: '第一章已确认'
    }
  ],
  canonFacts: [
    {
      key: 'lin-che-age',
      statement: '林澈二十七岁，是沿江站点的夜班外卖员。',
      source: '第一章'
    },
    {
      key: 'sister-missing',
      statement: '林遥在三年前的雨夜送出最后一单后失踪。',
      source: '第一章'
    },
    {
      key: 'radio-no-power',
      statement: '收音机没有电池和电源线，仍能收到求救广播。',
      source: '第一章'
    },
    {
      key: 'address-match',
      statement: '广播给出的临江里三栋十七层与林遥最后一单地址一致。',
      source: '第一章'
    }
  ],
  pendingChanges: {
    chapter: '第二章：收件地址',
    status: '待审阅，尚未写入故事档案',
    note: '以下内容来自第二章的提交预览。正式提交前，已确认事实不会改变。',
    changes: [
      {
        category: '时间线',
        change: '增加林澈抵达临江里三栋的事件。',
        evidence: '林澈在 00:26 进入门厅并核对楼层按钮。'
      },
      {
        category: '人物',
        change: '许雯对异常收件号码表现出隐瞒。',
        evidence: '她否认认识号码，却说出了号码所属的旧城区号段。'
      },
      {
        category: '待兑现悬念',
        change: '不存在的十七层从线索变为正在推进。',
        evidence: '值班表新增了十七层夜间巡查的书面记录。'
      }
    ]
  },
  recentActivity: [
    {
      key: 'chapter-review',
      when: '刚刚',
      title: '第二章修订通过章节检查',
      detail: '时间顺序问题已解决，等待审阅故事档案变更。'
    },
    {
      key: 'revision-accepted',
      when: '18 分钟前',
      title: '采纳第二章修订候选',
      detail: '保留临江里门厅场景，移除重复的订单交接。'
    },
    {
      key: 'chapter-one-commit',
      when: '昨天',
      title: '第一章已正式提交',
      detail: '4 项事实与 5 个时间点已写入故事档案。'
    }
  ]
};
