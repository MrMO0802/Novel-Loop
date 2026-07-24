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

export const archivedProjects: ProjectSummary[] = [
  {
    id: 'paper-moon',
    title: '纸月亮',
    currentChapter: 8,
    currentChapterTitle: '河对岸',
    status: 'committed',
    wordCount: 76400,
    updatedLabel: '三个月前',
    openMysteryCount: 0,
    pendingReviewCount: 0
  }
];

export const newNovelDraftFixture = {
  audience: '喜欢现实质感、慢热悬疑与人物关系的成年读者',
  chapterCount: 30,
  desiredFeeling: '好奇、不安，并开始怀疑求救者的真实身份',
  genre: '都市悬疑',
  protagonistDesire: '查清失踪姐姐最后一晚送出的那份外卖去了哪里',
  protagonistFear: '承认姐姐的失踪与自己当年的逃避有关',
  protagonistName: '林澈',
  storyLength: 240000,
  styleReference: '雨夜的城市细节要具体，异常始终从日常缝隙里出现',
  title: '雨夜电台',
  volumePacing: '前十章建立异常规律，中段加快地址追踪，卷末揭示姐姐留下的线索',
  voice: '克制、清晰，保留悬念',
  worldPlace: '一座沿江而建、老城区正在拆迁的南方城市',
  worldRule: '收音机只在雨夜播出，并且每次求救都指向一处即将消失的地址',
  centralSituation: '一名送餐员收到一台没有电源的收音机发来的求救。'
} as const;

export const storyBibleReviewFixture = `# 雨夜电台

## 核心承诺
送餐员林澈追查一台无电收音机里的求救声，也被迫重新面对姐姐失踪那晚留下的空白。

## 主角
林澈，二十七岁，熟悉城市每一条近路，却一直绕开与姐姐有关的旧城区。他想找到最后一份外卖的收件人，最害怕的是答案证明自己曾有机会阻止失踪。

## 世界规则
收音机只在雨夜播出。每次广播都会说出一处即将消失的地址，声音无法被普通录音设备保存。

## 第一卷方向
三十章内完成三次地址追踪。每个地址解决一个眼前危机，同时把林澈带回姐姐失踪前的行动轨迹。`;
