import { parseManuscriptParagraphs } from './diagnostics';
import { rainRadio } from './rainRadio';

export interface RevisionParagraphChange {
  candidate: string;
  id: string;
  original: string;
  paragraph: number;
}

export interface RevisionCandidateFixture {
  candidateDraft: string;
  changeReason: string;
  changes: readonly RevisionParagraphChange[];
  newIssueSummary: string;
  resolvedIssues: readonly string[];
}

const sourceParagraphs = parseManuscriptParagraphs(
  rainRadio.chapterWorkspace.versions.draft
);
const candidateDraft = rainRadio.chapterWorkspace.versions.revision_candidate;
const candidateParagraphs = parseManuscriptParagraphs(candidateDraft);

function changeAt(id: string, paragraph: number): RevisionParagraphChange {
  const original = sourceParagraphs[paragraph - 1];
  const candidate = candidateParagraphs[paragraph - 1];

  if (!original || !candidate) {
    throw new Error(`第 ${paragraph} 段不存在，无法建立修订对照。`);
  }

  return { candidate, id, original, paragraph };
}

export const chapterTwoRevision: RevisionCandidateFixture = {
  changeReason: '原稿把同一份送达放在雨夜零点后和当天下午。候选稿保留雨夜行动线，并删去重复的交接动作。',
  resolvedIssues: [
    '时间冲突已解决',
    '重复交接已删除',
    '没有新增订单或收件人'
  ],
  newIssueSummary: '没有发现新的问题',
  changes: [
    changeAt('delivery-time', 20),
    changeAt('handoff-memory', 21),
    changeAt('duplicate-handoff', 22),
    changeAt('security-memory', 32)
  ],
  candidateDraft
};
