import { chapterTwoAcceptedNarrative } from './rainRadio';

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

const groups: readonly CommitChangeGroupFixture[] = chapterTwoAcceptedNarrative.commitGroups;

export const chapterTwoCommitPreview: CommitPreviewFixture = {
  acceptedDraftLabel: '已接受草稿 · 尚未正式提交',
  groups,
  highRisk: {
    question: '临江里三栋不存在的十七层在哪里？',
    transition: '从“正在推进”变为“出现实体证据”',
    evidence: '第二章在零点五十分后的同一条雨夜行动线上，让登记表、按钮挡板和写有林遥姓名的小票共同指向十七层；正文仍没有解释入口如何存在。'
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
