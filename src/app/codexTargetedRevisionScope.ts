import type {
  TargetedRevisionDiff,
  TargetedRevisionOperation,
  TargetedRevisionPlan,
  TargetedRevisionScopeValidation
} from '../schemas/index.js';
import {
  TargetedRevisionDiffSchema,
  TargetedRevisionScopeValidationSchema
} from '../schemas/index.js';
import { sha256 } from './codexDiagnosticsEvidenceRules.js';

export interface MarkdownParagraphBlock {
  paragraphIndex: number;
  text: string;
  separator: string;
}

export interface AppliedTargetChange {
  targetId: string;
  paragraphIndexBefore: number;
  paragraphIndexAfter: number | null;
  operation: TargetedRevisionOperation;
  beforeText: string;
  afterText: string;
}

export interface ApplyTargetedRevisionResult {
  candidateText: string;
  changes: AppliedTargetChange[];
  sourceBlocks: MarkdownParagraphBlock[];
  nonTargetParagraphsUnchanged: boolean;
}

export function parseMarkdownParagraphBlocks(markdown: string): MarkdownParagraphBlock[] {
  const parts = markdown.split(/(\r?\n[ \t]*\r?\n+)/);
  const blocks: MarkdownParagraphBlock[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index] ?? '';
    const separator = parts[index + 1] ?? '';
    if (text.length === 0 && separator.length === 0) continue;
    blocks.push({ paragraphIndex: blocks.length + 1, text, separator });
  }
  return blocks;
}

export function applyTargetedRevisionOperations(sourceDraft: string, plan: TargetedRevisionPlan): ApplyTargetedRevisionResult {
  const sourceBlocks = parseMarkdownParagraphBlocks(sourceDraft);
  const targets = new Map(plan.allowedTargets.map((target) => [target.targetId, target]));
  const edits = new Map<number, { replacementText: string | null; operation: TargetedRevisionOperation; targetId: string }>();

  for (const operation of plan.operations) {
    if (/\r?\n[ \t]*\r?\n/.test(operation.replacementText)) {
      throw new Error(`Operation ${operation.operationId} introduces multiple paragraphs.`);
    }
    const operationTargets = operation.targetIds.map((targetId) => {
      const target = targets.get(targetId);
      if (target === undefined) throw new Error(`Operation ${operation.operationId} references unauthorized target ${targetId}.`);
      return target;
    }).sort((left, right) => left.paragraphIndex - right.paragraphIndex);
    if (operation.operationType === 'merge_target_paragraphs') {
      operationTargets.forEach((target, index) => {
        edits.set(target.paragraphIndex, {
          replacementText: index === 0 ? operation.replacementText.trim() : null,
          operation,
          targetId: target.targetId
        });
      });
      continue;
    }
    const target = operationTargets[0]!;
    edits.set(target.paragraphIndex, {
      replacementText: operation.operationType === 'delete_duplicate_paragraph' ? null : operation.replacementText.trim(),
      operation,
      targetId: target.targetId
    });
  }

  const candidateParts: string[] = [];
  const changes: AppliedTargetChange[] = [];
  let candidateIndex = 0;
  for (const block of sourceBlocks) {
    const edit = edits.get(block.paragraphIndex);
    if (edit === undefined) {
      candidateIndex += 1;
      candidateParts.push(`${block.text}${block.separator}`);
      continue;
    }
    if (edit.replacementText === null) {
      changes.push({
        targetId: edit.targetId,
        paragraphIndexBefore: block.paragraphIndex,
        paragraphIndexAfter: null,
        operation: edit.operation,
        beforeText: block.text,
        afterText: ''
      });
      continue;
    }
    candidateIndex += 1;
    candidateParts.push(`${edit.replacementText}${block.separator}`);
    changes.push({
      targetId: edit.targetId,
      paragraphIndexBefore: block.paragraphIndex,
      paragraphIndexAfter: candidateIndex,
      operation: edit.operation,
      beforeText: block.text,
      afterText: edit.replacementText
    });
  }

  const candidateText = candidateParts.join('');
  const changedIndexes = new Set(changes.map((change) => change.paragraphIndexBefore));
  const nonTargetParagraphsUnchanged = sourceBlocks
    .filter((block) => !changedIndexes.has(block.paragraphIndex))
    .every((block) => candidateText.includes(`${block.text}${block.separator}`));
  return { candidateText, changes, sourceBlocks, nonTargetParagraphsUnchanged };
}

export function buildTargetedRevisionScopeValidation(input: {
  projectId: string;
  chapterNumber: number;
  version: number;
  generatedAt: string;
  sourceDraftPath: string;
  candidateDraftPath: string;
  sourceDraft: string;
  applied: ApplyTargetedRevisionResult;
  plan: TargetedRevisionPlan;
  planningText: string;
}): TargetedRevisionScopeValidation {
  const sourceTitle = input.applied.sourceBlocks[0]?.text ?? '';
  const candidateTitle = parseMarkdownParagraphBlocks(input.applied.candidateText)[0]?.text ?? '';
  const changedText = input.applied.changes.map((change) => change.afterText).join('\n');
  const sourceText = input.sourceDraft;
  const newEntities = newMarkers(sourceText, changedText, [
    /(?:名叫|名为|新人物)\s*([\p{Script=Han}A-Za-z_]{2,20})/gu,
    /(?:陌生人|新角色|第二名住户)/gu
  ]);
  const newOrders = newMarkers(sourceText, changedText, [/(?:第二单|另一单|额外订单|又一单|新增订单)/gu]);
  const newRecipients = newMarkers(sourceText, changedText, [/(?:第二个住户|另一名住户|新收件人|陌生收件人)/gu]);
  const newReveals = newMarkers(sourceText, changedText, [/(?:真相是|身份是|凶手|幕后|原来[^。！？]{0,24}就是|其实[^。！？]{0,24}就是)/gu]);
  const expectedDaytime = /白天|午高峰|午间/.test(input.planningText);
  const introducedLateNight = /(?:深夜|凌晨|二十三点|(?:22|23|0[0-4])[:：][0-5]\d)/.test(changedText);
  const missionTimeAligned = !expectedDaytime || !introducedLateNight;
  const chapterTitleUnchanged = sourceTitle === candidateTitle;
  const unauthorizedChanges = [
    ...(!input.applied.nonTargetParagraphsUnchanged ? ['One or more non-target paragraphs changed or moved.'] : []),
    ...(!chapterTitleUnchanged ? ['Chapter title changed.'] : []),
    ...(!missionTimeAligned ? ['Targeted time change conflicts with daytime mission/selected-plan intent.'] : [])
  ];
  const scopeValid = unauthorizedChanges.length === 0 && newEntities.length === 0 && newOrders.length === 0 && newRecipients.length === 0 && newReveals.length === 0;
  return TargetedRevisionScopeValidationSchema.parse({
    reportId: `targeted_revision_scope_validation_ch${pad(input.chapterNumber)}_v${input.version}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    sourceDraftPath: input.sourceDraftPath,
    candidateDraftPath: input.candidateDraftPath,
    sourceDraftHash: sha256(input.sourceDraft),
    candidateDraftHash: sha256(input.applied.candidateText),
    changedParagraphs: input.applied.changes.map((change) => ({
      targetId: change.targetId,
      paragraphIndexBefore: change.paragraphIndexBefore,
      paragraphIndexAfter: change.paragraphIndexAfter,
      changeType: change.operation.operationType === 'replace_paragraph' ? 'replaced' : change.operation.operationType === 'delete_duplicate_paragraph' ? 'deleted' : 'merged',
      beforeHash: sha256(change.beforeText),
      afterHash: change.afterText.length === 0 ? null : sha256(change.afterText)
    })),
    unauthorizedChanges,
    preservedFacts: input.plan.factsToPreserve,
    newEntities,
    newOrders,
    newRecipients,
    newReveals,
    chapterTitleUnchanged,
    nonTargetParagraphsUnchanged: input.applied.nonTargetParagraphsUnchanged,
    missionTimeAligned,
    storyStateMutated: false,
    queueMutated: false,
    scopeValid,
    generatedAt: input.generatedAt
  });
}

export function buildTargetedRevisionDiff(input: {
  projectId: string;
  chapterNumber: number;
  version: number;
  generatedAt: string;
  sourceDraftPath: string;
  candidateDraftPath: string;
  changes: AppliedTargetChange[];
}): TargetedRevisionDiff {
  return TargetedRevisionDiffSchema.parse({
    reportId: `targeted_revision_diff_ch${pad(input.chapterNumber)}_v${input.version}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    sourceDraftPath: input.sourceDraftPath,
    candidateDraftPath: input.candidateDraftPath,
    generatedAt: input.generatedAt,
    changes: input.changes.map((change) => ({
      targetId: change.targetId,
      paragraphIndexBefore: change.paragraphIndexBefore,
      paragraphIndexAfter: change.paragraphIndexAfter,
      changeType: change.operation.operationType,
      beforeSnippet: change.beforeText.trim().slice(0, 600),
      afterSnippet: change.afterText.trim().slice(0, 600),
      beforeHash: sha256(change.beforeText),
      afterHash: change.afterText.length === 0 ? null : sha256(change.afterText),
      reason: change.operation.reason,
      addressedRules: change.operation.rulesAddressed
    })),
    storyStateMutated: false
  });
}

function newMarkers(sourceText: string, changedText: string, patterns: RegExp[]): string[] {
  const source = new Set(patterns.flatMap((pattern) => matches(sourceText, pattern)));
  return [...new Set(patterns.flatMap((pattern) => matches(changedText, pattern)).filter((marker) => !source.has(marker)))].sort();
}

function matches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

function pad(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}
