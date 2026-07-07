export type CodexPromptLikelyCategory =
  | 'health_check'
  | 'smoke'
  | 'exec_json_smoke'
  | 'json_repair'
  | 'normalization'
  | 'provider_inspect'
  | 'build_bible_subtask'
  | 'plan_global_subtask'
  | 'chapter_planning_subtask'
  | 'drafting_subtask'
  | 'diagnostics_subtask'
  | 'canon_patch_subtask'
  | 'unknown';

export interface CodexPromptStageMapping {
  stage: string;
  likelyCategory: CodexPromptLikelyCategory;
  promptFamily: string;
  classified: boolean;
}

const PROMPT_STAGE_RULES: Array<{
  match: (promptId: string) => boolean;
  stage: string;
  likelyCategory: CodexPromptLikelyCategory;
}> = [
  { match: (promptId) => promptId === 'provider.health', stage: 'health_check', likelyCategory: 'health_check' },
  { match: (promptId) => promptId.includes('exec_json'), stage: 'exec_json_smoke', likelyCategory: 'exec_json_smoke' },
  { match: (promptId) => promptId.includes('smoke'), stage: 'smoke', likelyCategory: 'smoke' },
  { match: (promptId) => promptId.includes('repair_json') || promptId.includes('repair'), stage: 'json_repair', likelyCategory: 'json_repair' },
  { match: (promptId) => promptId.includes('normalization'), stage: 'normalization', likelyCategory: 'normalization' },
  { match: (promptId) => promptId.includes('provider.inspect'), stage: 'provider_inspect', likelyCategory: 'provider_inspect' },
  { match: (promptId) => promptId.startsWith('strategy.') || promptId.includes('build_bible'), stage: 'build_bible', likelyCategory: 'build_bible_subtask' },
  { match: (promptId) => promptId === 'planning.validate_and_assemble', stage: 'plan_global_outline', likelyCategory: 'plan_global_subtask' },
  { match: (promptId) => promptId.includes('generate_global_outline') || promptId.includes('plan_global_outline'), stage: 'plan_global_outline', likelyCategory: 'plan_global_subtask' },
  { match: (promptId) => promptId.includes('generate_volume_outline') || promptId.includes('plan_volume_outline'), stage: 'plan_volume_outline', likelyCategory: 'plan_global_subtask' },
  { match: (promptId) => promptId.includes('arc_map'), stage: 'plan_arc_map', likelyCategory: 'plan_global_subtask' },
  { match: (promptId) => promptId.includes('chapter_queue'), stage: 'plan_chapter_queue', likelyCategory: 'plan_global_subtask' },
  { match: (promptId) => promptId.includes('plan_chapter_mission') || promptId.includes('chapter_mission'), stage: 'chapter_mission', likelyCategory: 'chapter_planning_subtask' },
  { match: (promptId) => promptId.includes('rank_plan_candidates') || promptId.includes('ranking'), stage: 'ranking', likelyCategory: 'chapter_planning_subtask' },
  { match: (promptId) => promptId.includes('generate_plan_candidates') || promptId.includes('plan_candidates'), stage: 'plan_candidates', likelyCategory: 'chapter_planning_subtask' },
  { match: (promptId) => promptId.includes('scene_cards'), stage: 'scene_cards', likelyCategory: 'chapter_planning_subtask' },
  { match: (promptId) => promptId.includes('write_scene'), stage: 'write_scene', likelyCategory: 'drafting_subtask' },
  { match: (promptId) => promptId.includes('diagnostics') || promptId.includes('diagnose'), stage: 'diagnostics', likelyCategory: 'diagnostics_subtask' },
  { match: (promptId) => promptId.includes('revision_plan') || promptId.includes('create_revision'), stage: 'revision_plan', likelyCategory: 'diagnostics_subtask' },
  { match: (promptId) => promptId.includes('final_chapter') || promptId.includes('rewrite_chapter'), stage: 'final_chapter', likelyCategory: 'drafting_subtask' },
  { match: (promptId) => promptId.includes('canon_patch'), stage: 'canon_patch_proposal', likelyCategory: 'canon_patch_subtask' },
  { match: (promptId) => promptId.includes('state_diff'), stage: 'state_diff', likelyCategory: 'canon_patch_subtask' }
];

export function inferCodexPromptStage(promptId: string): CodexPromptStageMapping {
  const normalized = promptId.toLowerCase().replace(/-/g, '_');
  const rule = PROMPT_STAGE_RULES.find((candidate) => candidate.match(normalized));
  if (rule === undefined) {
    return {
      stage: 'other_codex',
      likelyCategory: 'unknown',
      promptFamily: promptFamilyFor(promptId),
      classified: false
    };
  }
  return {
    stage: rule.stage,
    likelyCategory: rule.likelyCategory,
    promptFamily: promptFamilyFor(promptId),
    classified: true
  };
}

function promptFamilyFor(promptId: string): string {
  const [family] = promptId.split('.');
  return family === undefined || family.length === 0 ? 'unknown' : family;
}
