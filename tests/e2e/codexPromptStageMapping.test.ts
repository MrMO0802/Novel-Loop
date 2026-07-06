import { describe, expect, test } from 'vitest';

import { inferCodexPromptStage } from '../../src/providers/codex/promptStageMapping.js';

describe('M27.2 Codex prompt stage mapping', () => {
  test.each([
    ['strategy.build_bible', 'build_bible'],
    ['planning.generate_global_outline_text', 'plan_global_outline'],
    ['planning.generate_volume_outline_text', 'plan_volume_outline'],
    ['planning.generate_arc_map_minimal_json', 'plan_arc_map'],
    ['planning.generate_chapter_queue_minimal_json', 'plan_chapter_queue'],
    ['planning.plan_chapter_mission_slim', 'chapter_mission'],
    ['planning.generate_plan_candidates_slim', 'plan_candidates'],
    ['planning.rank_plan_candidates_slim', 'ranking'],
    ['planning.generate_scene_cards_slim', 'scene_cards'],
    ['production.write_scene', 'write_scene'],
    ['diagnostics.diagnose_chapter', 'diagnostics'],
    ['revision.create_revision_plan_slim', 'revision_plan'],
    ['revision.final_chapter', 'final_chapter'],
    ['memory.extract_canon_patch_proposal_slim', 'canon_patch_proposal'],
    ['codex.repair_json', 'json_repair'],
    ['provider.health', 'health_check'],
    ['codex.smoke', 'smoke'],
    ['codex.exec_json', 'exec_json_smoke']
  ])('maps %s to %s', (promptId, stage) => {
    expect(inferCodexPromptStage(promptId)).toMatchObject({
      stage,
      classified: true
    });
  });

  test('keeps unknown prompt ids in other_codex and marks them unclassified', () => {
    expect(inferCodexPromptStage('mystery.expensive_call')).toMatchObject({
      stage: 'other_codex',
      likelyCategory: 'unknown',
      classified: false
    });
  });
});
