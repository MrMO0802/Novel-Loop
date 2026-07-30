import { vi } from 'vitest';

import type {
  ChapterDraftReviewResult,
  ChapterInspection,
  ChapterPlanReviewResult,
  ChapterTask
} from '../../src/shared/chapterContract';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';

export function createInertChapterApi() {
  return {
    inspect: vi.fn<NovelLoopDesktopApi['chapter']['inspect']>()
      .mockResolvedValue({
        available: false,
        reason: 'global_plan_missing'
      }),
    startPlanning: vi.fn<NovelLoopDesktopApi['chapter']['startPlanning']>(),
    startDrafting: vi.fn<NovelLoopDesktopApi['chapter']['startDrafting']>(),
    get: vi.fn<NovelLoopDesktopApi['chapter']['get']>(),
    cancel: vi.fn<NovelLoopDesktopApi['chapter']['cancel']>(),
    readPlan: vi.fn<NovelLoopDesktopApi['chapter']['readPlan']>()
      .mockResolvedValue({ available: false, reason: 'not_ready' }),
    readDraft: vi.fn<NovelLoopDesktopApi['chapter']['readDraft']>()
      .mockResolvedValue({ available: false, reason: 'not_ready' })
  } satisfies NovelLoopDesktopApi['chapter'];
}

export const readyChapterInspection = {
  available: true,
  chapterNumber: 1,
  title: '凌晨三点十七分',
  phase: 'not_started'
} satisfies ChapterInspection;

export const completeChapterPlan: ChapterPlanReviewResult = {
  available: true,
  chapterNumber: 1,
  title: '凌晨三点十七分',
  mission: {
    chapterFunction: '让林默发现妹妹遗物中的异常报告，并建立城市循环的核心谜团。',
    objectives: [
      '确认报告会在每次循环后自动消失',
      '让林默决定追查下一轮循环'
    ],
    readerKnowledge: [
      '读者知道白箱市正在重复同一天',
      '读者知道林夕留下了异常回归测试'
    ],
    readerQuestions: [
      '林夕是否仍在下一轮循环中',
      '谁在删除异常报告'
    ],
    narrativePromises: [
      '推进“谁在删除异常报告”的悬念',
      '建立林夕可能仍在下一轮循环中的故事承诺'
    ],
    characterDeltas: [
      '林默：从逃避妹妹失踪转为主动追查循环',
      '林默对林夕的判断：从确认失踪转为怀疑她仍在等待'
    ],
    forbiddenMoves: [
      '不得揭示循环的最终成因',
      '不得让林默获得超出本章范围的答案'
    ]
  },
  selectedPlan: {
    title: '遗物中的异常报告',
    markdown: [
      '# 遗物中的异常报告',
      '',
      '林默在凌晨整理妹妹遗物，发现一份会自动消失的“白箱市异常回归测试”。',
      '',
      '<img src=x onerror=alert(1)>'
    ].join('\n')
  },
  alternatives: [
    {
      title: '从交通事故切入',
      excerpt: '林默先追查三日前重复发生的交通事故。',
      strengths: ['行动开场更直接'],
      risks: ['妹妹遗物的情感线出现较晚']
    },
    {
      title: '从监控记录切入',
      excerpt: '林默先发现同一段监控被重复覆盖。',
      strengths: ['循环证据清晰'],
      risks: ['人物动机需要额外铺垫']
    }
  ]
};

export const completeChapterDraft: ChapterDraftReviewResult = {
  available: true,
  chapterNumber: 1,
  title: '凌晨三点十七分',
  markdown: [
    '# 第 1 章 凌晨三点十七分',
    '',
    '林默把妹妹留下的纸箱搬到窗边时，电子钟刚好跳到三点十七分。',
    '',
    '屏幕上的“测试进行中”闪了一下，异常记录随即被自动删除。',
    '',
    '他记下消失前的最后一行字：下一轮，林夕仍在等他。'
  ].join('\n'),
  scenes: [
    { summary: '林默整理妹妹遗物，发现异常回归测试报告。' },
    { summary: '报告自动消失，林默决定追查下一轮循环。' }
  ]
};

export function chapterTask(
  overrides: Partial<ChapterTask> = {}
): ChapterTask {
  return {
    taskId: 'chapter_0123456789abcdef',
    projectKey: 'project_0123456789abcdef01234567',
    kind: 'planning',
    chapterNumber: 1,
    status: 'running',
    stage: 'preparing',
    completedStages: [],
    sceneProgress: null,
    startedAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:01.000Z',
    canCancel: true,
    canRetry: false,
    error: null,
    ...overrides
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
