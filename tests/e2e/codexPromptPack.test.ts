import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

const promptFiles = [
  'prompts/codex-text/planning/generate_global_outline_text.md',
  'prompts/codex-text/planning/generate_volume_outline_text.md',
  'prompts/codex-text/planning/generate_arc_map_minimal_json.md',
  'prompts/codex-text/planning/generate_chapter_queue_minimal_json.md',
  'prompts/codex-text/planning/plan_chapter_mission_slim.md',
  'prompts/codex-text/planning/generate_plan_candidates_slim.md',
  'prompts/codex-text/planning/rank_plan_candidates_slim.md',
  'prompts/codex-text/planning/generate_scene_cards_slim.md',
  'prompts/codex-text/planning/validate_and_assemble.md',
  'prompts/codex-text/production/write_scene.md',
  'prompts/codex-text/diagnostics/diagnose_chapter_slim.md',
  'prompts/codex-text/revision/create_revision_plan_slim.md',
  'prompts/codex-text/revision/targeted_revision_operations_slim.md',
  'prompts/codex-text/revision/rewrite_chapter.md',
  'prompts/codex-text/revision/final_chapter.md',
  'prompts/codex-text/memory/extract_canon_patch_proposal_slim.md',
  'prompts/codex-text/repair_json.md'
];

const slimSchemas = [
  'schemas/codex-output/slim/strategy.story_bible.slim.schema.json',
  'schemas/codex-output/slim/planning.arc_map.slim.schema.json',
  'schemas/codex-output/slim/planning.chapter_queue.slim.schema.json',
  'schemas/codex-output/slim/planning.chapter_mission.slim.schema.json',
  'schemas/codex-output/slim/planning.plan_candidates.slim.schema.json',
  'schemas/codex-output/slim/planning.ranking.slim.schema.json',
  'schemas/codex-output/slim/drafting.scene_cards.slim.schema.json',
  'schemas/codex-output/slim/diagnostics.report.slim.schema.json',
  'schemas/codex-output/slim/revision.plan.slim.schema.json',
  'schemas/codex-output/slim/revision.targeted_operations.slim.schema.json',
  'schemas/codex-output/slim/memory.canon_patch_proposal.slim.schema.json'
];

describe('M23 codex prompt pack and slim schemas', () => {
  test('codex prompt pack exists and asks for final-only bounded outputs', async () => {
    for (const file of promptFiles) {
      const text = await readFile(path.join(root, file), 'utf8');
      expect(text.trim().length).toBeGreaterThan(20);
      expect(text.toLowerCase()).toMatch(/final|return|output/);
      expect(text).not.toContain('{{STORY_STATE_JSON}}');
    }
  });

  test('slim schemas are closed JSON object schemas', async () => {
    for (const file of slimSchemas) {
      const schema = JSON.parse(await readFile(path.join(root, file), 'utf8')) as { type?: unknown; additionalProperties?: unknown; required?: unknown };
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(Array.isArray(schema.required)).toBe(true);
    }
  });
});
