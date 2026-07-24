import type { ProjectSummary } from './types';

export const projects: ProjectSummary[] = [
  {
    id: 'rain-radio',
    title: '雨夜电台',
    currentChapter: 2,
    currentChapterTitle: '收件地址',
    status: 'needs_review',
    wordCount: 42680,
    updatedLabel: '刚刚更新',
    openMysteryCount: 3,
    pendingReviewCount: 1
  },
  {
    id: 'changan-dream',
    title: '长安残梦',
    currentChapter: 16,
    currentChapterTitle: '春灯未灭',
    status: 'drafting',
    wordCount: 186420,
    updatedLabel: '今天 14:20',
    openMysteryCount: 7,
    pendingReviewCount: 0
  },
  {
    id: 'flight-zero',
    title: '零号航班',
    currentChapter: 1,
    currentChapterTitle: '故事基础',
    status: 'planned',
    wordCount: 8230,
    updatedLabel: '昨天',
    openMysteryCount: 2,
    pendingReviewCount: 0
  }
];
