import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { containsAuthorFacingInternalValue } from 'novel-loop-engine/author-facing';
import type {
  DesktopSubmissionDiagnostics, DesktopSubmissionPreview, DesktopSubmissionTask, DesktopSubmissionVerifiedPreview,
  SubmissionCheckInput, SubmissionCheckOptions, SubmissionProjectInput
} from 'novel-loop-engine/desktop';
import { z } from 'zod';
import {
  SubmissionChangeSchema, SubmissionDraftSummarySchema, SubmissionConfirmResultSchema, SubmissionIssueSchema,
  type SubmissionChange, type SubmissionDraftSummary, type SubmissionIssue
} from '../../shared/submissionContract';
import { EngineChapterGateway } from '../chapter/EngineChapterGateway';

export interface SubmissionConfirmInput extends SubmissionProjectInput {
  previewId: string;
  expectedManifestHash: string;
  approvalId: string;
  confirm: true;
}
export interface SubmissionCommitResult {
  chapterNumber: number;
  latestCommittedChapter: number;
  commitReportPath: string;
  hasNextChapter: boolean;
}
export type SubmissionRecovery =
  | { outcome: 'none' | 'recovery_required' }
  | { outcome: 'committed'; chapterNumber: number; latestCommittedChapter: number; hasNextChapter: boolean };

export interface TrustedSubmissionPreview {
  chapterNumber: number;
  previewId: string;
  manifestHash: string;
  draft: SubmissionDraftSummary;
  changes: SubmissionChange[];
  warnings: string[];
}

export interface SubmissionEngineGateway {
  readDraftIdentity(projectRoot: string): Promise<{ chapterNumber: number; sourceHash: string }>;
  check(input: SubmissionCheckInput, options: Pick<SubmissionCheckOptions, 'shouldCancel' | 'onProgress'>): Promise<DesktopSubmissionTask>;
  readPreview(input: SubmissionProjectInput): Promise<TrustedSubmissionPreview | null>;
  confirm(input: SubmissionConfirmInput): Promise<SubmissionCommitResult>;
  readTasks(projectRoot: string): Promise<DesktopSubmissionTask[]>;
  readIssues(projectRoot: string, task: DesktopSubmissionTask): Promise<SubmissionIssue[]>;
  readRecovery(projectRoot: string): Promise<SubmissionRecovery>;
}

/** Local-only engine operations; provider configuration never enters this port. */
export interface SubmissionLocalFacade {
  confirm(input: SubmissionConfirmInput): Promise<SubmissionCommitResult>;
  readTasks(input: { projectRoot: string }): Promise<DesktopSubmissionTask[]>;
  readDiagnostics(input: { projectRoot: string; taskId: string }): Promise<DesktopSubmissionDiagnostics | null>;
  // Must verify completed journal AND approval/final/patch/report/state/queue evidence.
  // Must inspect incomplete journals even when normal project validation fails.
  readRecovery(input: { projectRoot: string }): Promise<SubmissionRecovery>;
}

interface PreviewFacade {
  readDesktopSubmissionPreview(input: SubmissionProjectInput): Promise<DesktopSubmissionPreview | null>;
  verifyDesktopSubmissionPreviewIntegrity(preview: DesktopSubmissionPreview, root: string): Promise<DesktopSubmissionVerifiedPreview>;
  checkDesktopChapterSubmission(input: SubmissionCheckInput, options: Pick<SubmissionCheckOptions, 'shouldCancel' | 'onProgress'>): Promise<DesktopSubmissionTask>;
}

export class EngineSubmissionGateway implements SubmissionEngineGateway {
  constructor(
    private readonly local: SubmissionLocalFacade = {
      confirm: async input => (await import('novel-loop-engine/desktop')).confirmDesktopChapterSubmission(input),
      readTasks: async input => (await import('novel-loop-engine/desktop')).readDesktopSubmissionTasks(input),
      readDiagnostics: async input => (await import('novel-loop-engine/desktop')).readDesktopSubmissionDiagnostics(input),
      readRecovery: async input => (await import('novel-loop-engine/desktop')).readDesktopSubmissionRecovery(input)
    },
    private readonly previewFacade: () => Promise<PreviewFacade> = () => import('novel-loop-engine/desktop'),
    private readonly chapterGateway = new EngineChapterGateway()
  ) {}

  async readDraftIdentity(projectRoot: string) {
    const { review, sourceHash } = await this.chapterGateway.readDraftWithSource(projectRoot);
    if (!review.available || sourceHash === null) throw submissionError('source_missing');
    return z.object({ chapterNumber: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u) })
      .parse({ chapterNumber: review.chapterNumber, sourceHash });
  }

  async check(input: SubmissionCheckInput, options: Pick<SubmissionCheckOptions, 'shouldCancel' | 'onProgress'>) {
    return (await this.previewFacade()).checkDesktopChapterSubmission(input, options);
  }

  async readPreview(input: SubmissionProjectInput): Promise<TrustedSubmissionPreview | null> {
    const facade = await this.previewFacade();
    const preview = await facade.readDesktopSubmissionPreview(input);
    if (preview === null) return null;
    const relative = `chapters/chapter_${String(input.chapterNumber).padStart(3, '0')}/submission_previews/preview_v${preview.version}/manifest.json`;
    const before = await readManifest(input.projectRoot, relative);
    if (!isDeepStrictEqual(JSON.parse(before), preview)) throw submissionError('source_stale');
    const verified = await facade.verifyDesktopSubmissionPreviewIntegrity(preview, input.projectRoot);
    if (await readManifest(input.projectRoot, relative) !== before) throw submissionError('source_stale');
    const stateText = await readManifest(input.projectRoot, preview.source.state.path);
    if (createHash('sha256').update(stateText).digest('hex') !== preview.source.state.hash) throw submissionError('source_stale');
    const { names, placeholderCount } = storyNames([JSON.parse(stateText), verified.patch]);
    // Refuse an unrepresentable review rather than hide a change from the author.
    const changes = verified.diff.changes.flatMap(change => change.path === '/readerState'
      ? readerChanges(change) : [toAuthorChange(change, names)]);
    return {
      chapterNumber: preview.chapterNumber, previewId: preview.previewId,
      manifestHash: createHash('sha256').update(before).digest('hex'),
      draft: SubmissionDraftSummarySchema.parse({
        kind: preview.source.sourceKind,
        label: preview.source.sourceKind === 'adopted' ? '已采用正文' : '生成正文',
        summary: `第 ${preview.chapterNumber} 章，共 ${verified.sourceText.length} 字符。`
      }),
      changes, warnings: [
        ...(changes.some(change => change.risk === 'high') ? ['包含高风险变化，请逐项核对后再确认。'] : []),
        ...(placeholderCount > 0 ? [`有 ${placeholderCount} 位人物的姓名仍是系统占位标识，以下以“待命名人物”区分，请结合人物描述核对。此展示不会自动补全或更改提案中的姓名。`] : [])
      ]
    };
  }

  async confirm(input: SubmissionConfirmInput): Promise<SubmissionCommitResult> {
    // No client, provider, or model options exist on this local-only port.
    return this.local.confirm(input);
  }

  async readTasks(projectRoot: string) { return this.local.readTasks({ projectRoot }); }

  async readIssues(projectRoot: string, task: DesktopSubmissionTask): Promise<SubmissionIssue[]> {
    const result = await this.local.readDiagnostics({ projectRoot, taskId: task.taskId });
    if (result === null || !isDeepStrictEqual(result.task, task) || task.projectId !== path.basename(projectRoot)
      || result.diagnostics.chapterNumber !== task.chapterNumber) throw submissionError('invalid_output');
    const report = result.diagnostics;
    const issues: SubmissionIssue[] = [];
    const add = (severity: SubmissionIssue['severity'], message: string, evidence?: string, recommendation?: string) => {
      const text = [message, recommendation ? `修改建议：${recommendation}` : ''].filter(Boolean).join(' ');
      const safe = text.trim() && !unsafeAuthorText(text) ? text : '检查发现了问题，但包含不宜展示的内部信息，请修改正文后重新检查。';
      const quote = evidence?.trim();
      const grounded = quote && !unsafeAuthorText(quote) && result.sourceText.includes(quote) ? quote.slice(0, 1000) : null;
      for (let offset = 0; offset < safe.length; offset += 1800) {
        issues.push(SubmissionIssueSchema.parse({ severity, message: safe.slice(offset, offset + 1800), evidence: grounded }));
      }
    };
    for (const failure of report.hardFailures) add('error', failure.message, failure.evidence, failure.suggestedFix);
    for (const check of Object.values(report.hard_checks)) {
      if (!check.passed && !report.hardFailures.some(item => item.message === check.message && item.evidence === check.evidence)) {
        add('error', check.message, check.evidence);
      }
    }
    for (const objective of report.missionSatisfaction.objectiveResults) {
      if (!objective.satisfied) add('error', objective.issue ?? '本章尚未完成一项写作目标。', objective.evidence);
    }
    for (const issue of report.issues) {
      add(issue.severity === 'high' || issue.severity === 'critical' ? 'error' : 'warning', issue.message, issue.locationHint, issue.recommendation);
    }
    if (issues.length === 0) add('error', '本章未通过提交检查，请核对正文后重新检查。');
    if (issues.length > 100) return [...issues.slice(0, 99), { severity: 'warning', message: '问题较多，当前显示前部分结果。修正后请重新检查。', evidence: null }];
    return issues;
  }

  async readRecovery(projectRoot: string): Promise<SubmissionRecovery> {
    const result = await this.local.readRecovery({ projectRoot });
    if (result.outcome === 'committed') {
      const parsed = SubmissionConfirmResultSchema.parse(result);
      if (parsed.outcome !== 'committed') throw submissionError('recovery_required');
      return parsed;
    }
    return z.object({ outcome: z.enum(['none', 'recovery_required']) }).strict().parse(result);
  }
}

function readerChanges(change: DesktopSubmissionVerifiedPreview['diff']['changes'][number]): SubmissionChange[] {
  const strings = z.array(z.string());
  const before = z.object({ readerKnows: strings, readerSuspects: strings, readerQuestions: strings,
    readerExpectations: strings, readerDoesNotKnow: strings }).strict().parse(change.before);
  const patch = z.object({ addKnows: strings, addSuspects: strings, addQuestions: strings,
    removeQuestions: strings, addExpectations: strings, addDoesNotKnow: strings }).strict().parse(change.after);
  const entries: { label: string; text: string }[] = [];
  for (const [operation, current] of [
    ['addKnows', 'readerKnows'], ['addSuspects', 'readerSuspects'], ['addQuestions', 'readerQuestions'],
    ['addExpectations', 'readerExpectations'], ['addDoesNotKnow', 'readerDoesNotKnow']
  ] as const) {
    for (const text of new Set(patch[operation])) {
      if (!before[current].includes(text) && !(operation === 'addQuestions' && patch.removeQuestions.includes(text))) {
        entries.push({ label: fieldLabel(operation), text });
      }
    }
  }
  for (const text of new Set(patch.removeQuestions)) {
    if (before.readerQuestions.includes(text)) entries.push({ label: fieldLabel('removeQuestions'), text });
  }
  const risk = change.riskLevel === 'critical' ? 'high' : change.riskLevel;
  if (entries.length === 0) return [{ category: 'reader_information', risk, summary: '读者信息保持不变。' }];
  return entries.flatMap(({ label, text }) => {
    // Check the entire value before splitting so a credential cannot straddle safe-looking chunks.
    if (unsafeAuthorText(text)) {
      throw submissionError('invalid_output');
    }
    const chunks: SubmissionChange[] = [];
    for (let offset = 0; offset < Math.max(1, text.length); offset += 3500) {
      chunks.push(SubmissionChangeSchema.parse({ category: 'reader_information', risk,
        summary: `${label}${text.length > 3500 ? `（第 ${Math.floor(offset / 3500) + 1} 段）` : ''}：${text.slice(offset, offset + 3500)}` }));
    }
    return chunks;
  });
}

function unsafeAuthorText(text: string): boolean {
  return containsAuthorFacingInternalValue(text) || /\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]+|submission_[a-f0-9]{48})\b/iu.test(text);
}

function toAuthorChange(change: DesktopSubmissionVerifiedPreview['diff']['changes'][number], names: Map<string, string>): SubmissionChange {
  const categories: Record<string, SubmissionChange['category']> = {
    canonFacts: 'facts', characters: 'characters', timeline: 'timeline',
    narrativeDebts: 'narrative_debts', foreshadowing: 'foreshadowing',
    readerState: 'reader_information', relationshipGraph: 'relationships', worldRules: 'world_rules'
  };
  const field = change.path.split('/')[1] ?? '';
  if (field === 'latestCommittedChapter') {
    return SubmissionChangeSchema.parse({
      category: 'progress', risk: change.riskLevel === 'critical' ? 'high' : change.riskLevel,
      summary: `正式提交进度从第 ${change.before} 章推进到第 ${change.after} 章。`
    });
  }
  const category = categories[field];
  if (category === undefined) throw submissionError('invalid_output');
  const segments = change.path.split('/');
  const subject = names.get(segments[2] ?? '');
  const detail = segments[3] === undefined ? '' : fieldLabel(segments[3]);
  const actions = { added: '新增', removed: '移除', modified: '变更', unchanged: '保持不变' };
  return SubmissionChangeSchema.parse({
    category, risk: change.riskLevel === 'critical' ? 'high' : change.riskLevel,
    summary: `${subject ? `${subject}：` : ''}${detail}${actions[change.changeType]}。原为「${authorValue(change.before, names)}」；调整为「${authorValue(change.after, names)}」。`
  });
}

function authorValue(value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined) return '未设置';
  if (typeof value === 'string' && names.has(value)) return names.get(value)!;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return STATUS_LABELS[value] ?? value;
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(item => authorValue(item, names)).join('；') || '无';
  return Object.entries(value).filter(([key]) => !PROVENANCE_FIELDS.has(key))
    .map(([key, item]) => `${names.get(key) ?? fieldLabel(key)}：${authorValue(item, names)}`).join('；') || '无';
}

const PROVENANCE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'sourceSceneId', 'sceneId', 'introducedInSceneId']);
const FIELD_LABELS: Record<string, string> = {
  name: '名称', role: '角色定位', age: '年龄', text: '内容', content: '内容', summary: '概述',
  publicDescription: '公开描述', privateTruths: '隐藏真相', personality: '性格', desire: '渴望', fear: '恐惧', flaw: '缺点',
  currentGoal: '当前目标', emotionalState: '情绪', physicalState: '身体状态', knowledge: '掌握信息', arc: '成长轨迹',
  constraints: '限制', lastUpdatedChapter: '最近变化章节', factId: '相关事实', status: '状态', learnedInChapter: '获知章节',
  startingPoint: '起点', currentStage: '当前阶段', targetEndState: '目标状态', sourceChapter: '来源章节', type: '类型',
  visibility: '知情范围', reader: '读者知情', author: '作者知情', characters: '人物知情', confidence: '确定程度',
  chapter: '章节', order: '顺序', participants: '参与人物', location: '地点', timestampLabel: '故事时间',
  characterId: '人物', fromCharacterId: '起始人物', toCharacterId: '关联人物', change: '关系变化', evidence: '依据',
  relationship: '关系', debtId: '相关悬念', action: '处理方式', payload: '变化内容', promise: '叙事承诺',
  readerQuestion: '读者疑问', introducedInChapter: '首次出现章节', importance: '重要程度', urgency: '紧迫程度',
  payoffTargetChapter: '预期回收章节', relatedCharacters: '关联人物', relatedThreads: '关联线索', payoffHistory: '回收记录',
  effect: '效果', foreshadowingId: '相关伏笔', surfaceDetail: '表层细节', hiddenMeaning: '隐藏含义', subtlety: '隐蔽程度',
  relatedDebtId: '关联悬念', payoffText: '回收内容', readerKnows: '读者已知', readerSuspects: '读者怀疑', readerQuestions: '读者疑问',
  readerExpectations: '读者期待', readerDoesNotKnow: '读者未知', addKnows: '新增已知信息', addSuspects: '新增怀疑',
  addQuestions: '新增疑问', removeQuestions: '已解答疑问', addExpectations: '新增期待', addDoesNotKnow: '新增未知信息',
  relatedDebts: '关联悬念', rule: '规则', exceptions: '例外', source: '来源', strictness: '约束强度',
  truth: '真相', plannedRevealWindow: '计划揭晓范围', startChapter: '起始章节', endChapter: '结束章节', forbiddenBeforeChapter: '最早揭晓章节'
};
const STATUS_LABELS: Record<string, string> = {
  added: '新增', removed: '移除', modified: '调整', unchanged: '不变', create: '新增', maintain: '维持',
  escalate: '加深', partially_pay: '部分回收', pay: '回收', cancel: '取消', reinforce: '强化', abandon: '放弃',
  open: '未解决', escalated: '已加深', partially_paid: '部分回收', resolved: '已解决', paid: '已回收', cancelled: '已取消',
  unresolved: '未回收', reinforced: '已强化', abandoned: '已放弃', active: '进行中', paused: '暂停', deprecated: '已停用',
  knows: '知晓', believes: '相信', suspects: '怀疑', misunderstands: '误解', explicit: '明确', strongly_implied: '强烈暗示',
  weakly_implied: '微弱暗示', event: '事件', character: '人物', world: '世界观', relationship: '关系', object: '物品',
  mystery: '悬念', theme: '主题', power: '力量', revenge: '复仇', promise: '承诺', protagonist: '主角',
  deuteragonist: '第二主角', antagonist: '对手', supporting: '配角', minor: '次要人物', obvious: '明显', medium: '适中',
  subtle: '隐蔽', maintained: '已维持', hard: '严格', soft: '灵活', bible: '设定集', chapter: '章节', editor: '作者',
  hidden: '隐藏', hinted: '已暗示', suspected: '已引发怀疑', partially_revealed: '部分揭晓', revealed: '已揭晓'
};
function fieldLabel(field: string): string {
  const label = FIELD_LABELS[field];
  if (label === undefined) throw submissionError('invalid_output');
  return label;
}

function storyNames(values: unknown[]): { names: Map<string, string>; placeholderCount: number } {
  const names = new Map<string, string>();
  const placeholders = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    const id = record['id'];
    const name = record['name'] ?? record['title'] ?? record['promise'] ?? record['text'] ?? record['content'] ?? record['summary'] ?? record['surfaceDetail'] ?? record['truth'];
    if (typeof id === 'string' && typeof name === 'string') {
      // Legacy slim patches used the character ID as its name. Label that fact,
      // rather than leaking IDs, guessing a name, or rewriting approved evidence.
      if (name === id && /^char_[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id) && typeof record['publicDescription'] === 'string') {
        if (!placeholders.has(id)) placeholders.set(id, `待命名人物 ${placeholders.size + 1}（姓名为系统占位标识）`);
        names.set(id, placeholders.get(id)!);
      } else names.set(id, name);
    }
    Object.values(record).forEach(visit);
  };
  values.forEach(visit);
  return { names, placeholderCount: placeholders.size };
}

async function readManifest(root: string, relative: string): Promise<string> {
  if (await realpath(root) !== root) throw submissionError('unsafe_path');
  let target = root;
  const segments = relative.split('/');
  for (const [index, segment] of segments.entries()) {
    if (segment === '..' || segment === '.' || !segment) throw submissionError('unsafe_path');
    target = path.join(target, segment);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || (index < segments.length - 1 && !metadata.isDirectory())) throw submissionError('unsafe_path');
    if (await realpath(target) !== target) throw submissionError('unsafe_path');
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await handle.stat();
    const limit = 1024 * 1024;
    if (!metadata.isFile() || metadata.size > limit) throw submissionError('invalid_output');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > limit || await realpath(target) !== target) throw submissionError('unsafe_path');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
}

function submissionError(code: string) { return Object.assign(new Error('Submission is unavailable.'), { code }); }
