import { TargetCoverageGraphSchema } from '../../src/schemas/index.js';

export const approvedOperationTargets = [
  {
    targetId: 'target_p019',
    paragraphIndex: 19,
    allowedOperationTypes: ['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'] as const
  },
  {
    targetId: 'target_p020',
    paragraphIndex: 20,
    allowedOperationTypes: ['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'] as const
  },
  {
    targetId: 'target_p033',
    paragraphIndex: 33,
    allowedOperationTypes: ['replace_paragraph', 'merge_target_paragraphs'] as const
  },
  {
    targetId: 'target_p040',
    paragraphIndex: 40,
    allowedOperationTypes: ['replace_paragraph', 'delete_duplicate_paragraph', 'merge_target_paragraphs'] as const
  }
];

export const operationCoverageGraph = TargetCoverageGraphSchema.parse({
  graphId: 'target_coverage_graph_contract_fixture',
  projectId: 'contract-fixture',
  chapterNumber: 2,
  generatedAt: '2026-07-13T00:00:00.000Z',
  sourceDraftPath: 'chapters/chapter_002/draft_v1.md',
  sourceDraftHash: 'a'.repeat(64),
  sourceTimelineMapPath: 'chapters/chapter_002/timeline_contradiction_map_v1.json',
  sourceExperimentPath: 'chapters/chapter_002/targeted_revision_experiment_v1.json',
  nodes: [
    graphNode('event_delivery', 'event', null, 'delivery_event'),
    graphNode('paragraph_p019', 'paragraph_evidence', 19, 'delivery_event'),
    graphNode('paragraph_p020', 'paragraph_evidence', 20, 'delivery_event'),
    graphNode('action_sequence_original', 'action_sequence', 11, 'delivery_event'),
    graphNode('action_sequence_duplicate', 'action_sequence', 19, 'delivery_event'),
    graphNode('event_other', 'event', null, 'other_event'),
    graphNode('paragraph_p040', 'paragraph_evidence', 40, 'other_event')
  ],
  edges: [
    graphEdge('contains_p019', 'contains', 'event_delivery', 'paragraph_p019'),
    graphEdge('contains_p020', 'contains', 'event_delivery', 'paragraph_p020'),
    graphEdge('same_event_duplicate', 'same_event_identity', 'event_delivery', 'action_sequence_duplicate'),
    graphEdge('duplicate_sequence', 'duplicate_sequence', 'action_sequence_original', 'action_sequence_duplicate'),
    graphEdge('contains_p040', 'contains', 'event_other', 'paragraph_p040')
  ],
  uncoveredNodeIdsBefore: [],
  uncoveredEdgeIdsBefore: [],
  uncoveredNodeIdsAfter: [],
  uncoveredEdgeIdsAfter: [],
  coverageClosed: true,
  storyStateMutated: false,
  queueMutated: false
});

export function providerOperation(
  operationId: string,
  operationType: 'replace_paragraph' | 'delete_duplicate_paragraph' | 'merge_target_paragraphs',
  targetIds: string[],
  overrides: Partial<{
    replacementText: string;
    newFactsIntroduced: string[];
  }> = {}
) {
  return {
    operationId,
    operationType,
    targetIds,
    replacementText: overrides.replacementText ?? (operationType === 'delete_duplicate_paragraph' ? '' : 'Revised paragraph.'),
    reason: 'Resolve the approved contradiction.',
    expectedEffect: 'The approved contradiction is removed.',
    rulesAddressed: ['duplicate_event_repetition'],
    factsPreserved: ['The delivery remains canonical.'],
    newFactsIntroduced: overrides.newFactsIntroduced ?? []
  };
}

export function normalizationInput(operations: unknown[]) {
  return {
    projectId: 'contract-fixture',
    chapterNumber: 2,
    runId: 'run_contract_fixture',
    mode: 'contract_check' as const,
    generatedAt: '2026-07-13T00:00:00.000Z',
    rawProviderOutputPath: 'codex/runs/real/parsed_output.json',
    rawProviderOutputHash: 'b'.repeat(64),
    approvalRecordPath: 'chapters/chapter_002/target_expansion_approval_v1.json',
    coverageReportPath: 'chapters/chapter_002/target_coverage_closure_report_v2.json',
    targetCoverageGraphPath: 'chapters/chapter_002/target_coverage_graph_v2.json',
    providerOutput: { operations },
    approvedTargets: approvedOperationTargets,
    coverageGraph: operationCoverageGraph
  };
}

function graphNode(
  nodeId: string,
  nodeType: 'event' | 'paragraph_evidence' | 'action_sequence',
  paragraphIndex: number | null,
  eventIdentity: string
) {
  return {
    nodeId,
    nodeType,
    label: nodeId,
    sourcePath: 'chapters/chapter_002/draft_v1.md',
    paragraphIndex,
    snippetHash: paragraphIndex === null ? null : 'c'.repeat(64),
    eventIdentity,
    mutableEndpoint: nodeType === 'paragraph_evidence',
    initiallyTargeted: false,
    proposedTarget: nodeType === 'paragraph_evidence',
    explicitlyPreserved: false
  };
}

function graphEdge(
  edgeId: string,
  edgeType: 'contains' | 'same_event_identity' | 'duplicate_sequence',
  fromNodeId: string,
  toNodeId: string
) {
  return {
    edgeId,
    edgeType,
    fromNodeId,
    toNodeId,
    linkedClaimIds: [],
    linkedContradictionIds: [],
    description: edgeId,
    coveredBefore: false,
    projectedCoveredAfter: true
  };
}
