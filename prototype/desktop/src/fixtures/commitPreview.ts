export type CommitChangeGroupKind =
  | 'facts'
  | 'character'
  | 'timeline'
  | 'mystery'
  | 'foreshadowing'
  | 'reader';

export interface CommitChangeItem {
  detail: string;
  title: string;
}

export interface CommitChangeGroupFixture {
  items: readonly CommitChangeItem[];
  kind: CommitChangeGroupKind;
}

export type HighRiskDecision = 'approve' | 'revise' | 'reject';

export interface CommitReadinessFixture {
  label: string;
  status: 'fail' | 'pass' | 'warning';
}

export interface CommitPreviewFixture {
  acceptedDraftLabel: string;
  groups: readonly CommitChangeGroupFixture[];
  highRisk: {
    evidence: string;
    question: string;
    transition: string;
  };
  readiness: readonly CommitReadinessFixture[];
  sourceChapter: string;
  technical: {
    basis: string;
    reviewReference: string;
  };
}

const groups: readonly CommitChangeGroupFixture[] = [
  {
    kind: 'facts',
    items: [
      {
        title: '1704 室的收件人没有留下真实姓名',
        detail: '第二章只确认收件地址与匿名状态，不推断求救者身份。'
      },
      {
        title: '许雯在下午四点前完成包裹交接',
        detail: '交接发生在天亮时，与修订后的章节时间一致。'
      },
      {
        title: '林澈在夜班开始前拿到登记表',
        detail: '登记表成为他核对送达时间的直接依据。'
      },
      {
        title: '十七层电梯在交接后停用',
        detail: '停用发生在林澈准备上楼之前。'
      },
      {
        title: '求救信号再次提到“收件地址”',
        detail: '电台内容与包裹标签形成新的联系。'
      }
    ]
  },
  {
    kind: 'character',
    items: [
      {
        title: '林澈开始怀疑包裹与电台求救有关',
        detail: '他的当前目标增加了核对收件地址这一行动。'
      }
    ]
  },
  {
    kind: 'timeline',
    items: [
      {
        title: '15:50，许雯抵达电台门厅',
        detail: '她带着送往 1704 室的匿名包裹。'
      },
      {
        title: '16:00，许雯把包裹交给林澈',
        detail: '保安目击交接，登记表随后交到林澈手中。'
      },
      {
        title: '23:40，林澈开始夜班',
        detail: '包裹仍在值班室，没有被送上十七层。'
      },
      {
        title: '次日 00:40，求救信号再次出现',
        detail: '信号提到与包裹相同的收件地址。'
      }
    ]
  },
  {
    kind: 'mystery',
    items: [
      {
        title: '电台求救者是谁？',
        detail: '第二次信号把求救者与 1704 室的收件地址进一步关联。'
      }
    ]
  },
  {
    kind: 'foreshadowing',
    items: [
      {
        title: '没有电源的收音机再次播出求救',
        detail: '线索由第一章的异常现象推进为可重复出现的信号。'
      },
      {
        title: '匿名包裹上的 1704 室地址',
        detail: '地址与求救内容重合，后续需要解释是谁安排送达。'
      }
    ]
  },
  {
    kind: 'reader',
    items: [
      {
        title: '读者已经知道：包裹在下午完成交接',
        detail: '修订后的章节给出了明确且唯一的交接时间。'
      },
      {
        title: '读者已经知道：求救信号提到 1704 室',
        detail: '地址联系已经出现在正文中。'
      },
      {
        title: '读者可能猜到：包裹与求救者有关',
        detail: '目前仍是推测，正文没有确认具体身份。'
      },
      {
        title: '读者正在期待：林澈进入十七层调查',
        detail: '电梯停用让这一行动延后，而不是完成。'
      }
    ]
  }
];

export const chapterTwoCommitPreview: CommitPreviewFixture = {
  acceptedDraftLabel: '已接受草稿 · 尚未正式提交',
  groups,
  highRisk: {
    question: '电台求救者是谁？',
    transition: '从“尚未推进”变为“正在升级”',
    evidence: '第二章让求救信号再次出现，并把它与 1704 室的收件地址联系起来；正文支持升级悬念，但没有揭示求救者身份。'
  },
  readiness: [
    { label: '第二章关键一致性检查已通过', status: 'pass' },
    { label: '已接受草稿与本次预览来源一致', status: 'pass' },
    { label: '当前故事档案是生成预览时的版本', status: 'pass' }
  ],
  sourceChapter: '第二章 · 收件地址',
  technical: {
    basis: 'preview.chapter-2.accepted-draft.v1',
    reviewReference: 'mystery.radio-caller.transition'
  }
};

export const staleChapterTwoCommitPreview: CommitPreviewFixture = {
  ...chapterTwoCommitPreview,
  readiness: [
    { label: '第二章关键一致性检查已通过', status: 'pass' },
    { label: '已接受草稿与本次预览来源一致', status: 'pass' },
    {
      label: '需要刷新：故事档案已在这份预览生成后发生变化。',
      status: 'fail'
    }
  ],
  technical: {
    basis: 'preview.chapter-2.accepted-draft.stale',
    reviewReference: 'story-record.changed-after-preview'
  }
};
