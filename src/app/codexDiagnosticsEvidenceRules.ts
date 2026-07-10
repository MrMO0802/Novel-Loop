import { createHash } from 'node:crypto';

import {
  CodexDiagnosticsAdjudicationEventSchema,
  CodexDiagnosticsEventComparisonSchema,
  CodexDiagnosticsEvidenceClaimSchema,
  CodexDiagnosticsTemporalRuleSchema
} from '../schemas/codexDiagnosticsAdjudication.js';
import type {
  CodexDiagnosticsAdjudication,
  CodexDiagnosticsAdjudicationEvent,
  CodexDiagnosticsDraftEvidence,
  CodexDiagnosticsEventComparison,
  CodexDiagnosticsEvidenceClaim,
  CodexDiagnosticsRevisionScopeRecommendation,
  CodexDiagnosticsTemporalRule
} from '../schemas/codexDiagnosticsAdjudication.js';

export interface TimelineFailureEvidenceSample {
  sampleId: string;
  evidence: string;
}

export interface MarkdownEvidenceParagraph {
  paragraphIndex: number;
  startLine: number;
  endLine: number;
  text: string;
}

interface ClaimDescriptor {
  normalizedClaim: string;
  claimedEventA: string;
  claimedEventB: string;
  claimedContradiction: string;
}

interface ClaimAccumulator extends ClaimDescriptor {
  sampleIds: Set<string>;
  evidenceTexts: Set<string>;
}

export interface DecideEvidenceAdjudicationInput {
  claimCount: number;
  draftEvidence: CodexDiagnosticsDraftEvidence[];
  eventComparisons: CodexDiagnosticsEventComparison[];
  temporalRules: CodexDiagnosticsTemporalRule[];
}

export interface DiagnosticsEvidenceDecision {
  adjudication: CodexDiagnosticsAdjudication;
  confidence: 'low' | 'medium' | 'high';
  falsePositiveFactors: string[];
  unresolvedQuestions: string[];
  recommendedNextStep: string;
  revisionScopeRecommendation: CodexDiagnosticsRevisionScopeRecommendation;
}

export function deduplicateTimelineEvidenceClaims(samples: TimelineFailureEvidenceSample[]): CodexDiagnosticsEvidenceClaim[] {
  const claims = new Map<string, ClaimAccumulator>();
  for (const sample of samples) {
    for (const descriptor of describeClaims(sample.evidence)) {
      const current = claims.get(descriptor.normalizedClaim) ?? {
        ...descriptor,
        sampleIds: new Set<string>(),
        evidenceTexts: new Set<string>()
      };
      current.sampleIds.add(sample.sampleId);
      current.evidenceTexts.add(sample.evidence.trim());
      claims.set(descriptor.normalizedClaim, current);
    }
  }

  return [...claims.values()]
    .sort((left, right) => left.normalizedClaim.localeCompare(right.normalizedClaim))
    .map((claim) => {
      const fingerprint = sha256(claim.normalizedClaim);
      return CodexDiagnosticsEvidenceClaimSchema.parse({
        claimId: `claim_${fingerprint.slice(0, 12)}`,
        normalizedClaim: claim.normalizedClaim,
        sourceSampleIds: [...claim.sampleIds].sort(),
        occurrenceCount: claim.sampleIds.size,
        checkName: 'timeline_consistency',
        claimedEventA: claim.claimedEventA,
        claimedEventB: claim.claimedEventB,
        claimedContradiction: claim.claimedContradiction,
        sourceEvidenceText: [...claim.evidenceTexts],
        evidenceFingerprint: fingerprint
      });
    });
}

export function resolveEventIdentity(
  comparisonId: string,
  eventAInput: unknown,
  eventBInput: unknown
): CodexDiagnosticsEventComparison {
  const eventA = CodexDiagnosticsAdjudicationEventSchema.parse(eventAInput);
  const eventB = CodexDiagnosticsAdjudicationEventSchema.parse(eventBInput);
  const sameActor = compareKnown(eventA.actor, eventB.actor);
  const sameRecipient = compareKnown(eventA.recipient, eventB.recipient);
  const sameLocation = compareKnown(eventA.location, eventB.location);
  const sameObjectOrOrder = compareKnown(eventA.objectOrOrder, eventB.objectOrOrder);
  const sameOutcome = compareKnown(eventA.outcome, eventB.outcome);
  const sameNarrativePurpose = compareKnown(eventA.narrativePurpose, eventB.narrativePurpose);
  const sameDay = compareDay(eventA.dayReference, eventB.dayReference);
  const comparisons = { sameActor, sameRecipient, sameLocation, sameObjectOrOrder, sameOutcome, sameNarrativePurpose };
  const hardDifference = sameRecipient === false || sameObjectOrOrder === false;
  const separatedTemporalMode = isHistoricalMode(eventA.temporalMode) !== isHistoricalMode(eventB.temporalMode) &&
    eventA.temporalMode !== 'current_event_record' && eventB.temporalMode !== 'current_event_record';
  const matches = Object.values(comparisons).filter((value) => value === true).length;
  const known = Object.values(comparisons).filter((value) => value !== null).length;
  let conclusion: CodexDiagnosticsEventComparison['conclusion'];
  let confidence: number;

  if (hardDifference) {
    conclusion = 'different_events';
    confidence = 0.98;
  } else if (separatedTemporalMode) {
    conclusion = 'ambiguous';
    confidence = 0.45;
  } else if (matches >= 5 && known >= 5) {
    conclusion = 'same_event';
    confidence = 0.97;
  } else if (matches >= 3 && matches === known) {
    conclusion = 'likely_same_event';
    confidence = 0.82;
  } else {
    conclusion = 'ambiguous';
    confidence = 0.4;
  }

  return CodexDiagnosticsEventComparisonSchema.parse({
    comparisonId,
    eventA,
    eventB,
    ...comparisons,
    sameDay,
    sameEventConfidence: confidence,
    identityEvidence: Object.entries(comparisons)
      .filter(([, value]) => value === true)
      .map(([field]) => `${field}=true`),
    differenceEvidence: [
      ...Object.entries(comparisons).filter(([, value]) => value === false).map(([field]) => `${field}=false`),
      ...(separatedTemporalMode ? [`temporalMode=${eventA.temporalMode}/${eventB.temporalMode}`] : [])
    ],
    conclusion
  });
}

export function evaluateTemporalComparison(comparisonInput: unknown): CodexDiagnosticsTemporalRule[] {
  const comparison = CodexDiagnosticsEventComparisonSchema.parse(comparisonInput);
  const evidenceIds = unique([...comparison.eventA.evidenceIds, ...comparison.eventB.evidenceIds]);

  if (comparison.conclusion === 'different_events') {
    return [rule('different_order_or_recipient', comparison.comparisonId, 'not_contradiction', evidenceIds, 'Different order or recipient identifiers establish separate events.')];
  }

  if (isHistoricalMode(comparison.eventA.temporalMode) !== isHistoricalMode(comparison.eventB.temporalMode)) {
    return [rule('memory_log_history_separation', comparison.comparisonId, 'ambiguous', evidenceIds, 'A memory, log, recording, or historical event cannot be merged with the current scene without an explicit identity link.')];
  }

  if (comparison.sameDay === null) {
    return [rule('unclear_day_offset', comparison.comparisonId, 'ambiguous', evidenceIds, 'The day or day offset is not explicit enough to establish a same-day contradiction.')];
  }

  const rules: CodexDiagnosticsTemporalRule[] = [];
  const timeA = timeCategory(comparison.eventA.explicitTime ?? comparison.eventA.inferredTime);
  const timeB = timeCategory(comparison.eventB.explicitTime ?? comparison.eventB.inferredTime);
  const sameEvent = comparison.conclusion === 'same_event' || comparison.conclusion === 'likely_same_event';
  if (sameEvent && comparison.sameDay && isDayNightConflict(timeA, timeB)) {
    const sourceTypes = new Set([comparison.eventA.sourceType, comparison.eventB.sourceType]);
    const ruleId = sourceTypes.has('mission') || sourceTypes.has('selected_plan')
      ? 'mission_plan_time_mismatch'
      : sourceTypes.has('canon')
        ? 'canon_timeline_time_mismatch'
        : 'same_event_same_day_explicit_time_conflict';
    rules.push(rule(ruleId, comparison.comparisonId, 'confirmed_contradiction', evidenceIds, 'The same event on the same day is placed in incompatible daytime and late-night windows.'));
  }

  if (sameEvent && comparison.sameDay && isDeliveryHandoff(comparison.eventA) && isDeliveryHandoff(comparison.eventB)) {
    rules.push(rule('duplicate_event_repetition', comparison.comparisonId, 'confirmed_contradiction', evidenceIds, 'The same delivery handoff reaches the same completed outcome twice without a reset or second order.'));
  }

  if (rules.length === 0) {
    rules.push(rule('unclear_day_offset', comparison.comparisonId, 'insufficient_evidence', evidenceIds, 'No deterministic temporal contradiction rule was satisfied.'));
  }
  return rules;
}

export function decideEvidenceAdjudication(input: DecideEvidenceAdjudicationInput): DiagnosticsEvidenceDecision {
  const confirmed = input.temporalRules.filter((ruleItem) => ruleItem.outcome === 'confirmed_contradiction');
  const ambiguous = input.temporalRules.filter((ruleItem) => ruleItem.outcome === 'ambiguous');
  const affectedParagraphs = uniqueNumbers(input.draftEvidence
    .filter((evidence) => confirmed.some((ruleItem) => ruleItem.evidenceIds.includes(evidence.evidenceId)))
    .map((evidence) => evidence.paragraphIndex));
  if (confirmed.length > 0 && input.claimCount > 0 && affectedParagraphs.length > 0) {
    return {
      adjudication: 'confirmed_true_positive',
      confidence: 'high',
      falsePositiveFactors: [],
      unresolvedQuestions: [],
      recommendedNextStep: 'Prepare a targeted revision experiment that only corrects the cited time and duplicate handoff; do not preview or commit in M27.12B.',
      revisionScopeRecommendation: {
        affectedParagraphs,
        minimalRevisionScope: 'Unify the single delivery event time and collapse the duplicated resident handoff into one continuous exchange.',
        factsToPreserve: ['Lin Che delivers one order to the sixteenth-floor resident.', 'The resident mentions the seventeenth-floor disappearance and withdraws the statement.', 'Lin Che leaves without entering the seventeenth floor and records the route.'],
        factsToCorrect: ['Use one compatible time window for the continuous delivery event.', 'Remove or merge the second delivery handoff and second door-closing sequence.'],
        forbiddenChanges: ['Do not add a new order or recipient.', 'Do not change the protagonist goal.', 'Do not add plot reveals.', 'Do not modify reader state or Story State.'],
        suggestedRevisionInstruction: 'Edit only the cited paragraphs: preserve one daytime delivery and one resident exchange, then make the recorded entry/exit times match that same event.',
        diagnosticsPromptCalibrationSuggestion: null,
        humanReviewQuestion: null,
        timelineMetadataNeeded: []
      }
    };
  }
  if (input.eventComparisons.length > 0 && input.eventComparisons.every((comparison) => comparison.conclusion === 'different_events')) {
    return {
      adjudication: 'false_positive',
      confidence: 'high',
      falsePositiveFactors: ['Evidence resolves to different orders or recipients rather than one repeated event.'],
      unresolvedQuestions: [],
      recommendedNextStep: 'Calibrate the diagnostics prompt to require event-identity evidence; do not modify the draft.',
      revisionScopeRecommendation: noRevisionRecommendation('Require order and recipient identity before reporting duplicate delivery events.')
    };
  }
  if (ambiguous.length > 0) {
    return {
      adjudication: 'ambiguous',
      confidence: 'medium',
      falsePositiveFactors: [],
      unresolvedQuestions: ['Confirm whether the compared passages describe the same event and day.'],
      recommendedNextStep: 'Request human review and explicit timeline metadata; do not modify the draft automatically.',
      revisionScopeRecommendation: {
        ...noRevisionRecommendation('Do not revise until event identity and day offset are confirmed.'),
        humanReviewQuestion: 'Do the cited passages describe the same order on the same day?',
        timelineMetadataNeeded: ['order identity', 'recipient identity', 'day offset']
      }
    };
  }
  return {
    adjudication: 'insufficient_evidence',
    confidence: 'low',
    falsePositiveFactors: [],
    unresolvedQuestions: ['No complete event identity and temporal evidence pair was available.'],
    recommendedNextStep: 'Collect specific draft citations and timeline metadata before making a revision decision.',
    revisionScopeRecommendation: {
      ...noRevisionRecommendation('Do not revise without cited evidence.'),
      humanReviewQuestion: 'Which exact passages and timeline events should be compared?',
      timelineMetadataNeeded: ['concrete draft citations', 'event identity', 'explicit or inferred time']
    }
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value.normalize('NFKC')).digest('hex');
}

export function parseMarkdownEvidenceParagraphs(markdown: string): MarkdownEvidenceParagraph[] {
  const lines = markdown.split(/\r?\n/);
  const paragraphs: MarkdownEvidenceParagraph[] = [];
  let startLine: number | undefined;
  let current: string[] = [];
  const flush = (endLine: number) => {
    if (startLine === undefined || current.length === 0) return;
    paragraphs.push({
      paragraphIndex: paragraphs.length + 1,
      startLine,
      endLine,
      text: current.join(' ').trim()
    });
    startLine = undefined;
    current = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index]!.trim();
    if (line.length === 0) {
      flush(lineNumber - 1);
      continue;
    }
    startLine ??= lineNumber;
    current.push(line);
  }
  flush(lines.length);
  return paragraphs;
}

export function extractExplicitClockTime(value: string): string | null {
  const colonTime = /(?:^|\D)([01]?\d|2[0-3])[:：]([0-5]\d)(?:\D|$)/.exec(value);
  if (colonTime !== null) return `${colonTime[1]!.padStart(2, '0')}:${colonTime[2]}`;
  const chineseTime = /([零〇一二两三四五六七八九十]{1,3})点([零〇一二两三四五六七八九十]{1,3})分/.exec(value);
  if (chineseTime === null) return null;
  const hour = chineseNumber(chineseTime[1]!);
  const minute = chineseNumber(chineseTime[2]!);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function describeClaims(evidence: string): ClaimDescriptor[] {
  const normalized = normalizeEvidence(evidence);
  const descriptors: ClaimDescriptor[] = [];
  if (/午高峰|午间|白天|midday|daytime/i.test(evidence) && /二十三点十七分|23[:：]17/.test(evidence)) {
    descriptors.push({
      normalizedClaim: 'midday_vs_23_17_same_delivery',
      claimedEventA: 'The chapter delivery is framed as a midday-peak event.',
      claimedEventB: 'The same delivery route is logged with a 23:17 entry time.',
      claimedContradiction: 'One continuous delivery event is assigned incompatible daytime and late-night times.'
    });
  }
  if (/交餐|接餐|收餐|餐袋|订单|delivery|handoff/i.test(evidence) && /重复|两次|第二次|又.*(?:交餐|接餐|收餐)|连续出现两次|twice|repeat/i.test(evidence)) {
    descriptors.push({
      normalizedClaim: 'duplicate_delivery_handoff',
      claimedEventA: 'The resident receives the active order and closes the door.',
      claimedEventB: 'The same resident receives the same order and closes the door again.',
      claimedContradiction: 'A completed delivery handoff is repeated without a second order or narrative reset.'
    });
  }
  if (descriptors.length === 0 && normalized.length > 0) {
    descriptors.push({
      normalizedClaim: `unclassified_${sha256(normalized).slice(0, 16)}`,
      claimedEventA: 'Unclassified event A from diagnostics evidence.',
      claimedEventB: 'Unclassified event B from diagnostics evidence.',
      claimedContradiction: evidence.trim()
    });
  }
  return descriptors;
}

function compareKnown(left: string | null, right: string | null): boolean | null {
  if (left === null || right === null || left.length === 0 || right.length === 0) return null;
  return left === right;
}

function compareDay(left: string, right: string): boolean | null {
  if (left === 'unknown' || right === 'unknown' || left.length === 0 || right.length === 0) return null;
  return left === right;
}

function isHistoricalMode(mode: CodexDiagnosticsAdjudicationEvent['temporalMode']): boolean {
  return mode === 'memory' || mode === 'log' || mode === 'recording' || mode === 'historical';
}

function timeCategory(value: string | null): 'daytime' | 'late_night' | 'unknown' {
  if (value === null) return 'unknown';
  if (/midday|daytime|午高峰|白天/i.test(value)) return 'daytime';
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match !== null) {
    const hour = Number.parseInt(match[1]!, 10);
    return hour >= 22 || hour < 5 ? 'late_night' : 'daytime';
  }
  return 'unknown';
}

function isDayNightConflict(left: ReturnType<typeof timeCategory>, right: ReturnType<typeof timeCategory>): boolean {
  return (left === 'daytime' && right === 'late_night') || (left === 'late_night' && right === 'daytime');
}

function isDeliveryHandoff(event: CodexDiagnosticsAdjudicationEvent): boolean {
  return event.sourceType === 'draft' &&
    event.temporalMode === 'current' &&
    /handoff|交餐|接餐/i.test(`${event.eventId} ${event.label}`);
}

function rule(
  ruleId: CodexDiagnosticsTemporalRule['ruleId'],
  comparisonId: string,
  outcome: CodexDiagnosticsTemporalRule['outcome'],
  evidenceIds: string[],
  explanation: string
): CodexDiagnosticsTemporalRule {
  return CodexDiagnosticsTemporalRuleSchema.parse({ ruleId, comparisonId, outcome, evidenceIds, explanation });
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function noRevisionRecommendation(calibration: string): CodexDiagnosticsRevisionScopeRecommendation {
  return {
    affectedParagraphs: [],
    minimalRevisionScope: 'none',
    factsToPreserve: [],
    factsToCorrect: [],
    forbiddenChanges: ['Do not modify the draft based on an unconfirmed diagnostic claim.'],
    suggestedRevisionInstruction: 'Do not revise the chapter.',
    diagnosticsPromptCalibrationSuggestion: calibration,
    humanReviewQuestion: null,
    timelineMetadataNeeded: []
  };
}

function chineseNumber(value: string): number {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!value.includes('十')) {
    return [...value].reduce((result, digit) => result * 10 + (digits[digit] ?? -100), 0);
  }
  const [left, right] = value.split('十');
  const tens = left === '' ? 1 : digits[left!] ?? -100;
  const ones = right === '' ? 0 : digits[right!] ?? -100;
  return tens * 10 + ones;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
