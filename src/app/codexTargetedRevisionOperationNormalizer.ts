import { createHash } from 'node:crypto';

import {
  NormalizedTargetedRevisionOperationSchema,
  TargetedRevisionOperationNormalizationSchema,
  TargetedRevisionProviderOperationSchema,
  TargetedRevisionProviderOutputSchema
} from '../schemas/index.js';
import type {
  NormalizedTargetedRevisionOperation,
  TargetCoverageGraph,
  TargetedRevisionOperationContractErrorCode,
  TargetedRevisionOperationNormalization,
  TargetedRevisionProviderOperation
} from '../schemas/index.js';

export interface ApprovedRevisionOperationTarget {
  targetId: string;
  paragraphIndex: number;
  allowedOperationTypes: ReadonlyArray<'replace_paragraph' | 'delete_duplicate_paragraph' | 'merge_target_paragraphs'>;
  requiredForClosure?: boolean;
}

export interface NormalizeTargetedRevisionOperationsInput {
  projectId: string;
  chapterNumber: number;
  runId: string;
  mode: 'pipeline' | 'contract_check';
  generatedAt: string;
  rawProviderOutputPath: string;
  rawProviderOutputHash: string;
  approvalRecordPath: string;
  coverageReportPath: string;
  targetCoverageGraphPath: string;
  targetCoverageGraphHash?: string;
  providerOutput: unknown;
  approvedTargets: readonly ApprovedRevisionOperationTarget[];
  coverageGraph: TargetCoverageGraph;
  protectedArtifacts?: TargetedRevisionOperationNormalization['protectedArtifacts'];
  reportId?: string;
  codexInvoked?: boolean;
}

export interface NormalizeTargetedRevisionOperationsResult {
  report: TargetedRevisionOperationNormalization;
  normalizedOperations: NormalizedTargetedRevisionOperation[];
  failure?: {
    code: TargetedRevisionOperationContractErrorCode;
    message: string;
  };
}

export function normalizeTargetedRevisionOperations(
  input: NormalizeTargetedRevisionOperationsInput
): NormalizeTargetedRevisionOperationsResult {
  const providerValidation = TargetedRevisionProviderOutputSchema.safeParse(input.providerOutput);
  if (!providerValidation.success) {
    const rejected = classifyProviderContractFailure(input.providerOutput);
    return failedResult(input, rawOperationCount(input.providerOutput), false, rejected.code, rejected.message, rejected.operation);
  }

  const approvedById = new Map(input.approvedTargets.map((target) => [target.targetId, target]));
  const sourceOperationIds = new Set<string>();
  const usedTargets = new Set<string>();
  const normalized: NormalizedTargetedRevisionOperation[] = [];
  const entries: TargetedRevisionOperationNormalization['operations'] = [];

  for (const operation of providerValidation.data.operations) {
    if (sourceOperationIds.has(operation.operationId)) {
      return failedResult(
        input,
        providerValidation.data.operations.length,
        true,
        'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
        `Provider operationId is duplicated: ${operation.operationId}.`,
        operation
      );
    }
    sourceOperationIds.add(operation.operationId);

    const targetValidation = validateTargets(operation, approvedById, usedTargets);
    if (targetValidation !== undefined) {
      return failedResult(input, providerValidation.data.operations.length, true, targetValidation.code, targetValidation.message, operation);
    }

    if (operation.operationType === 'delete_duplicate_paragraph' && operation.targetIds.length > 1) {
      const sequenceValidation = validateAtomicSplitSequence(operation, approvedById, input.coverageGraph);
      if (sequenceValidation !== undefined) {
        return failedResult(input, providerValidation.data.operations.length, true, sequenceValidation.code, sequenceValidation.message, operation);
      }
      const splitOperations = operation.targetIds.map((targetId, index) => normalizedOperation(operation, {
        operationId: `${operation.operationId}__atomic_${String(index + 1).padStart(2, '0')}_${targetId}`,
        targetIds: [targetId],
        normalizationMode: 'atomic_split',
        normalizationReason: `Safely split approved same-sequence delete ${operation.operationId} into one canonical delete for ${targetId}.`
      }));
      normalized.push(...splitOperations);
      entries.push({
        sourceOperationId: operation.operationId,
        sourceOperationType: operation.operationType,
        sourceTargetIds: operation.targetIds,
        normalizedOperationIds: splitOperations.map((item) => item.operationId),
        normalizedTargetIds: splitOperations.flatMap((item) => item.targetIds),
        normalizationMode: 'atomic_split',
        normalizationReason: 'A provider multi-target delete was decomposed into semantically equivalent single-target canonical deletes.',
        semanticEquivalenceConfirmed: true,
        approvedTargetCheckPassed: true,
        allowedOperationCheckPassed: true,
        sequenceIdentityCheckPassed: true
      });
      continue;
    }

    const direct = normalizedOperation(operation, {
      operationId: operation.operationId,
      targetIds: operation.targetIds,
      normalizationMode: 'passthrough',
      normalizationReason: 'Provider operation already satisfies the canonical cardinality contract.'
    });
    normalized.push(direct);
    entries.push({
      sourceOperationId: operation.operationId,
      sourceOperationType: operation.operationType,
      sourceTargetIds: operation.targetIds,
      normalizedOperationIds: [direct.operationId],
      normalizedTargetIds: direct.targetIds,
      normalizationMode: 'passthrough',
      normalizationReason: direct.normalizationReason,
      semanticEquivalenceConfirmed: true,
      approvedTargetCheckPassed: true,
      allowedOperationCheckPassed: true,
      sequenceIdentityCheckPassed: operation.operationType !== 'delete_duplicate_paragraph' || hasDuplicateSequenceEvidence(operation.targetIds, approvedById, input.coverageGraph)
    });
  }

  const canonicalSchemaValid = normalized.every((operation) => NormalizedTargetedRevisionOperationSchema.safeParse(operation).success);
  if (!canonicalSchemaValid) {
    return failedResult(
      input,
      providerValidation.data.operations.length,
      true,
      'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
      'Normalized operations did not satisfy the canonical operation schema.',
      providerValidation.data.operations[0]
    );
  }
  const requiredTargets = input.approvedTargets.filter((target) => target.requiredForClosure === true).map((target) => target.targetId);
  const normalizedTargets = new Set(normalized.flatMap((operation) => operation.targetIds));
  const missingRequired = requiredTargets.filter((targetId) => !normalizedTargets.has(targetId));

  const report = TargetedRevisionOperationNormalizationSchema.parse({
    ...baseReport(input),
    providerSchemaValid: true,
    canonicalSchemaValid: true,
    coveragePreflightPassed: missingRequired.length === 0,
    sourceOperationCount: providerValidation.data.operations.length,
    normalizedOperationCount: normalized.length,
    normalizedOperations: normalized,
    operations: entries,
    rejectedOperations: [],
    warnings: missingRequired.length === 0
      ? []
      : [`Normalized operations omit required approved targets: ${missingRequired.join(', ')}.`],
    semanticChangesIntroduced: false,
    normalizationSucceeded: true
  });
  return { report, normalizedOperations: normalized };
}

export function renderTargetedRevisionOperationNormalization(
  report: TargetedRevisionOperationNormalization
): string {
  const normalized = report.operations.map((operation) =>
    `- ${operation.sourceOperationId}: ${operation.normalizationMode}; ${operation.sourceTargetIds.length} source target(s) -> ${operation.normalizedOperationIds.length} canonical operation(s)`
  ).join('\n') || '- none';
  const rejected = report.rejectedOperations.map((operation) =>
    `- ${operation.sourceOperationId}: ${operation.errorCode}; ${operation.reason}`
  ).join('\n') || '- none';
  return `# Targeted Revision Operation Normalization\n\nnormalizationSucceeded: ${report.normalizationSucceeded}\nproviderSchemaValid: ${report.providerSchemaValid}\ncanonicalSchemaValid: ${report.canonicalSchemaValid}\ncoveragePreflightPassed: ${report.coveragePreflightPassed}\nsourceOperationCount: ${report.sourceOperationCount}\nnormalizedOperationCount: ${report.normalizedOperationCount}\nsemanticChangesIntroduced: false\nstoryStateMutated: false\n\n## Operations\n${normalized}\n\n## Rejected Operations\n${rejected}\n`;
}

function validateTargets(
  operation: TargetedRevisionProviderOperation,
  approvedById: Map<string, ApprovedRevisionOperationTarget>,
  usedTargets: Set<string>
): { code: TargetedRevisionOperationContractErrorCode; message: string } | undefined {
  for (const targetId of operation.targetIds) {
    const target = approvedById.get(targetId);
    if (target === undefined) {
      return {
        code: 'CODEX_TARGETED_REVISION_OPERATION_TARGET_NOT_APPROVED',
        message: `Operation ${operation.operationId} references unapproved target ${targetId}.`
      };
    }
    if (!target.allowedOperationTypes.includes(operation.operationType)) {
      return {
        code: 'CODEX_TARGETED_REVISION_OPERATION_TYPE_NOT_ALLOWED',
        message: `${operation.operationType} is not approved for ${targetId}.`
      };
    }
    if (usedTargets.has(targetId)) {
      return {
        code: 'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE',
        message: `Approved target ${targetId} is referenced by more than one provider operation.`
      };
    }
    usedTargets.add(targetId);
  }
  return undefined;
}

function validateAtomicSplitSequence(
  operation: TargetedRevisionProviderOperation,
  approvedById: Map<string, ApprovedRevisionOperationTarget>,
  graph: TargetCoverageGraph
): { code: TargetedRevisionOperationContractErrorCode; message: string } | undefined {
  if (new Set(operation.targetIds).size !== operation.targetIds.length) {
    return {
      code: 'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE',
      message: `Multi-target delete ${operation.operationId} contains duplicate target ids.`
    };
  }
  if (operation.replacementText.length !== 0 || operation.newFactsIntroduced.length !== 0) {
    return {
      code: 'CODEX_TARGETED_REVISION_DELETE_CARDINALITY_INVALID',
      message: `Multi-target delete ${operation.operationId} must have empty replacementText and introduce no facts.`
    };
  }
  if (!operation.rulesAddressed.some((rule) => /duplicate/i.test(rule))) {
    return {
      code: 'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE',
      message: `Multi-target delete ${operation.operationId} does not address a duplicate-sequence rule.`
    };
  }
  if (!hasDuplicateSequenceEvidence(operation.targetIds, approvedById, graph)) {
    return {
      code: 'CODEX_TARGETED_REVISION_SEQUENCE_IDENTITY_MISMATCH',
      message: `Multi-target delete ${operation.operationId} spans targets without one approved duplicate-sequence event identity.`
    };
  }
  return undefined;
}

function hasDuplicateSequenceEvidence(
  targetIds: string[],
  approvedById: Map<string, ApprovedRevisionOperationTarget>,
  graph: TargetCoverageGraph
): boolean {
  const identities = new Set<string>();
  for (const targetId of targetIds) {
    const target = approvedById.get(targetId);
    if (target === undefined) return false;
    const nodeIdentities = [...new Set(graph.nodes
      .filter((node) => node.nodeType === 'paragraph_evidence' && node.paragraphIndex === target.paragraphIndex && node.eventIdentity !== null)
      .map((node) => node.eventIdentity!))];
    if (nodeIdentities.length !== 1) return false;
    identities.add(nodeIdentities[0]!);
  }
  if (identities.size !== 1) return false;
  const identity = [...identities][0]!;
  const sequenceNodeIds = new Set(graph.nodes
    .filter((node) => node.nodeType === 'action_sequence' && node.eventIdentity === identity)
    .map((node) => node.nodeId));
  return graph.edges.some((edge) => edge.edgeType === 'duplicate_sequence' &&
    (sequenceNodeIds.has(edge.fromNodeId) || sequenceNodeIds.has(edge.toNodeId)));
}

function normalizedOperation(
  operation: TargetedRevisionProviderOperation,
  normalized: {
    operationId: string;
    targetIds: string[];
    normalizationMode: 'passthrough' | 'atomic_split';
    normalizationReason: string;
  }
): NormalizedTargetedRevisionOperation {
  return NormalizedTargetedRevisionOperationSchema.parse({
    ...operation,
    operationId: normalized.operationId,
    targetIds: normalized.targetIds,
    parentOperationId: operation.operationId,
    sourceOperationId: operation.operationId,
    normalizationMode: normalized.normalizationMode,
    normalizationReason: normalized.normalizationReason
  });
}

function failedResult(
  input: NormalizeTargetedRevisionOperationsInput,
  sourceOperationCount: number,
  providerSchemaValid: boolean,
  code: TargetedRevisionOperationContractErrorCode,
  message: string,
  operation: Partial<TargetedRevisionProviderOperation> | undefined
): NormalizeTargetedRevisionOperationsResult {
  const report = TargetedRevisionOperationNormalizationSchema.parse({
    ...baseReport(input),
    providerSchemaValid,
    canonicalSchemaValid: false,
    coveragePreflightPassed: false,
    sourceOperationCount,
    normalizedOperationCount: 0,
    normalizedOperations: [],
    operations: [],
    rejectedOperations: [{
      sourceOperationId: operation?.operationId ?? 'unknown_provider_operation',
      sourceOperationType: operation?.operationType ?? null,
      sourceTargetIds: operation?.targetIds ?? [],
      errorCode: code,
      reason: message
    }],
    warnings: [],
    semanticChangesIntroduced: false,
    normalizationSucceeded: false
  });
  return { report, normalizedOperations: [], failure: { code, message } };
}

function baseReport(input: NormalizeTargetedRevisionOperationsInput) {
  return {
    reportId: input.reportId ?? `targeted_revision_operation_normalization_ch${String(input.chapterNumber).padStart(3, '0')}`,
    projectId: input.projectId,
    chapterNumber: input.chapterNumber,
    runId: input.runId,
    mode: input.mode,
    generatedAt: input.generatedAt,
    rawProviderOutputPath: input.rawProviderOutputPath,
    rawProviderOutputHash: input.rawProviderOutputHash,
    approvalRecordPath: input.approvalRecordPath,
    coverageReportPath: input.coverageReportPath,
    targetCoverageGraphPath: input.targetCoverageGraphPath,
    targetCoverageGraphHash: input.targetCoverageGraphHash ?? sha256(JSON.stringify(input.coverageGraph, null, 2) + '\n'),
    approvedTargetIds: input.approvedTargets.map((target) => target.targetId),
    protectedArtifacts: input.protectedArtifacts ?? [],
    codexInvoked: input.codexInvoked ?? input.mode === 'pipeline',
    storyStateMutated: false as const,
    queueMutated: false as const,
    canonicalArtifactsMutated: false as const
  };
}

function classifyProviderContractFailure(providerOutput: unknown): {
  code: TargetedRevisionOperationContractErrorCode;
  message: string;
  operation: Partial<TargetedRevisionProviderOperation> | undefined;
} {
  const raw = firstInvalidRawOperation(providerOutput);
  const operation = raw === undefined ? undefined : partialOperation(raw);
  if (operation?.operationType === 'delete_duplicate_paragraph') {
    if (operation.targetIds !== undefined && new Set(operation.targetIds).size !== operation.targetIds.length) {
      return {
        code: 'CODEX_TARGETED_REVISION_ATOMIC_SPLIT_UNSAFE',
        message: `Provider delete ${operation.operationId ?? 'unknown'} contains duplicate target ids.`,
        operation
      };
    }
    return {
      code: 'CODEX_TARGETED_REVISION_DELETE_CARDINALITY_INVALID',
      message: `Provider delete ${operation.operationId ?? 'unknown'} violates the transport delete contract.`,
      operation
    };
  }
  return {
    code: 'CODEX_TARGETED_REVISION_OPERATION_CONTRACT_MISMATCH',
    message: `Provider operation ${operation?.operationId ?? 'unknown'} violates the transport operation contract.`,
    operation
  };
}

function rawOperationCount(providerOutput: unknown): number {
  if (!isRecord(providerOutput) || !Array.isArray(providerOutput.operations)) return 0;
  return providerOutput.operations.length;
}

function firstInvalidRawOperation(providerOutput: unknown): unknown {
  if (!isRecord(providerOutput) || !Array.isArray(providerOutput.operations)) return undefined;
  return providerOutput.operations.find((operation) =>
    !TargetedRevisionProviderOperationSchema.safeParse(operation).success
  ) ?? providerOutput.operations[0];
}

function partialOperation(value: unknown): Partial<TargetedRevisionProviderOperation> | undefined {
  if (!isRecord(value)) return undefined;
  const operationType = value.operationType === 'replace_paragraph' || value.operationType === 'delete_duplicate_paragraph' || value.operationType === 'merge_target_paragraphs'
    ? value.operationType
    : undefined;
  return {
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
    ...(operationType === undefined ? {} : { operationType }),
    ...(Array.isArray(value.targetIds) && value.targetIds.every((item) => typeof item === 'string') ? { targetIds: value.targetIds } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value.normalize('NFKC')).digest('hex');
}
