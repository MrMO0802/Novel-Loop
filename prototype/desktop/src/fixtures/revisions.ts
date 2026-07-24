export interface RevisionParagraphChange {
  candidate: string;
  id: string;
  original: string;
  paragraph: number;
}

export interface RevisionCandidateFixture {
  acceptedDraft: string;
  changeReason: string;
  changes: readonly RevisionParagraphChange[];
  newIssueSummary: string;
  resolvedIssues: readonly string[];
}

export const chapterTwoRevision: RevisionCandidateFixture = {
  changeReason: '原稿把同一份送达放在雨夜零点后和当天下午。候选稿保留雨夜行动线，并删去重复的交接动作。',
  resolvedIssues: [
    '时间冲突已解决',
    '重复交接已删除',
    '没有新增指令或收件人'
  ],
  newIssueSummary: '没有发现新的问题',
  changes: [
    {
      id: 'arrival-time',
      paragraph: 2,
      original: '下午四点，林澈接过许雯递来的订单，地址写着临江里三栋十七层 1704。',
      candidate: '零点四十分后，林澈接过许雯递来的订单，地址写着临江里三栋十七层 1704。'
    },
    {
      id: 'security-memory',
      paragraph: 20,
      original: '保安记得那次交接发生在天还亮着的时候。',
      candidate: '保安只记得林澈冒雨进门，没有为那次交接补上另一个时间。'
    },
    {
      id: 'duplicate-handoff',
      paragraph: 22,
      original: '许雯又把那张写着十七层的单子推给他。',
      candidate: '林澈把订单折好收进口袋，转身走进更密的雨里。'
    }
  ],
  acceptedDraft: `零点四十分后，林澈接过许雯递来的订单，地址写着临江里三栋十七层 1704。

登记表把同一份送达记在零点五十分。林澈冒雨进门，没有人为这次交接补上另一个时间。

他把订单折好收进口袋，转身走进更密的雨里。`
};
