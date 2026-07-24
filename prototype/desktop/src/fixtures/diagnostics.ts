import { rainRadio } from './rainRadio';

export type DiagnosticSeverity = 'blocking' | 'advisory';

export interface DiagnosticEvidence {
  paragraph: number;
  excerpt: string;
}

export interface DiagnosticTechnicalDetails {
  explanation: string;
  ruleName: string;
}

export interface DiagnosticFindingFixture {
  evidence: readonly DiagnosticEvidence[];
  id: string;
  severity: DiagnosticSeverity;
  summary: string;
  technicalDetails: DiagnosticTechnicalDetails;
  title: string;
  whyItMatters: string;
}

export interface ChapterDiagnosticsFixture {
  findings: readonly DiagnosticFindingFixture[];
  overview: string;
}

export function parseManuscriptParagraphs(manuscript: string): string[] {
  return manuscript
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim());
}

const sourceParagraphs = parseManuscriptParagraphs(
  rainRadio.chapterWorkspace.versions.draft
);

function evidenceAt(paragraph: number): DiagnosticEvidence {
  const excerpt = sourceParagraphs[paragraph - 1];

  if (!excerpt) {
    throw new Error(`第 ${paragraph} 段不存在，无法建立诊断证据。`);
  }

  return { paragraph, excerpt };
}

export const chapterTwoDiagnostics: ChapterDiagnosticsFixture = {
  overview: '检查发现一项需要先处理的时间顺序问题，以及一项不阻止继续审阅的表达提醒。',
  findings: [
    {
      id: 'delivery-time-conflict',
      severity: 'blocking',
      title: '同一份送达发生在两个不相容的时间',
      summary: '同一次送达先被写成雨夜零点后的行动，后文又把它放在当天下午，两个时间无法同时成立。',
      whyItMatters: '这会打乱人物行动的先后关系，也会让读者无法判断林澈何时收到地址、何时抵达三栋。',
      evidence: [2, 11, 20, 32].map(evidenceAt),
      technicalDetails: {
        ruleName: 'timeline_delivery_single_clock',
        explanation: '同一事件的明确时间无法排序，且正文没有提供跨日或回忆场景的说明。'
      }
    },
    {
      id: 'handoff-clarity',
      severity: 'advisory',
      title: '交接动作可以再明确一些',
      summary: '两处相邻段落都写了许雯递出订单，读起来像同一个动作发生了两次。',
      whyItMatters: '删去重复动作后，场景推进会更紧凑，也能避免读者误以为出现了第二份订单。',
      evidence: [21, 22].map(evidenceAt),
      technicalDetails: {
        ruleName: 'scene_handoff_repetition',
        explanation: '相邻动作拥有相同发起人、接收人和物件，没有新的叙事结果。'
      }
    }
  ]
};
