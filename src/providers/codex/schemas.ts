import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CodexOutputSchemaDescriptor {
  schemaName: string;
  schemaPath: string;
}

const SCHEMA_ROOT = fileURLToPath(
  new URL('../../../schemas/codex-output/', import.meta.url)
);

const CODEX_OUTPUT_SCHEMAS: Record<string, CodexOutputSchemaDescriptor> = {
  'strategy.build_story_bible': descriptor('CodexStoryBibleResponseSchema', 'strategy.story_bible.schema.json'),
  'strategy.build_genre_contract': descriptor('CodexGenreContractResponseSchema', 'strategy.genre_contract.schema.json'),
  'strategy.build_reader_promise': descriptor('CodexReaderPromiseResponseSchema', 'strategy.reader_promise.schema.json'),
  'strategy.build_style_guide': descriptor('CodexStyleGuideResponseSchema', 'strategy.style_guide.schema.json'),
  'planning.generate_arc_map': descriptor('CodexArcMapOutputSchema', 'planning.arc_map.schema.json'),
  'planning.generate_chapter_queue': descriptor('CodexChapterQueueOutputSchema', 'planning.chapter_queue.schema.json'),
  'planning.generate_arc_map_minimal_json': slimDescriptor('CodexSlimArcMapOutputSchema', 'planning.arc_map.slim.schema.json'),
  'planning.generate_chapter_queue_minimal_json': slimDescriptor('CodexSlimChapterQueueOutputSchema', 'planning.chapter_queue.slim.schema.json'),
  'planning.plan_chapter_mission_slim': slimDescriptor('CodexSlimChapterMissionOutputSchema', 'planning.chapter_mission.slim.schema.json'),
  'planning.generate_plan_candidates_slim': slimDescriptor('CodexSlimPlanCandidatesOutputSchema', 'planning.plan_candidates.slim.schema.json'),
  'planning.rank_plan_candidates_slim': slimDescriptor('CodexSlimRankingOutputSchema', 'planning.ranking.slim.schema.json'),
  'planning.generate_scene_cards_slim': slimDescriptor('CodexSlimSceneCardsOutputSchema', 'drafting.scene_cards.slim.schema.json'),
  'diagnostics.diagnose_chapter_slim': slimDescriptor('CodexSlimDiagnosticsOutputSchema', 'diagnostics.report.slim.schema.json'),
  'revision.create_revision_plan_slim': slimDescriptor('CodexSlimRevisionPlanOutputSchema', 'revision.plan.slim.schema.json'),
  'revision.targeted_revision_operations_slim': slimDescriptor('TargetedRevisionProviderOutputSchema', 'revision.targeted_operations.slim.schema.json'),
  'memory.extract_canon_patch_proposal_slim': slimDescriptor('CodexSlimCanonPatchProposalOutputSchema', 'memory.canon_patch_proposal.slim.schema.json'),
  'planning.plan_chapter_mission': descriptor('CodexChapterMissionOutputSchema', 'planning.chapter_mission.schema.json'),
  'planning.generate_plan_candidates': descriptor('CodexPlanCandidatesOutputSchema', 'planning.plan_candidates.schema.json'),
  'planning.rank_plan_candidates': descriptor('CodexPlanRankingOutputSchema', 'planning.ranking.schema.json'),
  'planning.generate_scene_cards': descriptor('CodexSceneCardsOutputSchema', 'planning.scene_cards.schema.json'),
  'diagnostics.diagnose_chapter': descriptor('CodexDiagnosticsOutputSchema', 'diagnostics.report.schema.json'),
  'memory.extract_canon_patch': descriptor('CodexCanonPatchOutputSchema', 'memory.canon_patch.schema.json')
};

export function resolveCodexOutputSchema(promptId: string): CodexOutputSchemaDescriptor | undefined {
  return CODEX_OUTPUT_SCHEMAS[promptId];
}

export function listCodexOutputSchemas(): CodexOutputSchemaDescriptor[] {
  return Object.values(CODEX_OUTPUT_SCHEMAS);
}

function descriptor(schemaName: string, fileName: string): CodexOutputSchemaDescriptor {
  return {
    schemaName,
    schemaPath: path.join(SCHEMA_ROOT, fileName)
  };
}

function slimDescriptor(schemaName: string, fileName: string): CodexOutputSchemaDescriptor {
  return {
    schemaName,
    schemaPath: path.join(SCHEMA_ROOT, 'slim', fileName)
  };
}
