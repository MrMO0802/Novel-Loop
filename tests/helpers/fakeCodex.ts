import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FakeCodexMode =
  | 'valid'
  | 'invalid-json'
  | 'schema-invalid'
  | 'doctor-unhealthy'
  | 'slim-valid'
  | 'retry-invalid-first'
  | 'repair-schema-invalid'
  | 'repair-fails'
  | 'plugin-warning'
  | 'missing-output'
  | 'codex-controlled-valid'
  | 'codex-controlled-invalid-patch'
  | 'codex-controlled-conflict'
  | 'codex-controlled-diagnostics-fail';

export async function writeFakeCodex(root: string, mode: FakeCodexMode = 'valid'): Promise<{ codexBin: string; argsLogPath: string }> {
  const codexBin = path.join(root, `fake-codex-${mode}.cjs`);
  const argsLogPath = path.join(root, `fake-codex-${mode}.log`);
  const statePath = path.join(root, `fake-codex-${mode}.state.json`);
  await writeFile(
    codexBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argsLogPath)}, args.join(' ') + '\\n');
const mode = ${JSON.stringify(mode)};
const statePath = ${JSON.stringify(statePath)};
if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in as fake-codex@example.com\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write(JSON.stringify({ ok: mode !== 'doctor-unhealthy', terminal: { token: 'sk-SECRET', authFile: '/home/user/.codex/auth.json' } }) + '\\n');
  process.exit(mode === 'doctor-unhealthy' ? 1 : 0);
}
if (args.includes('exec')) {
  const stdin = fs.readFileSync(0, 'utf8');
  const outputIndex = args.indexOf('--output-last-message');
  const outputFile = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const schemaMode = args.includes('--output-schema');
  const promptId = (stdin.match(/PROMPT_ID:\\s*([^\\n]+)/) || [])[1] || 'unknown';
  const repairMode = stdin.includes('REPAIR_JSON_ONLY');
  const callNumber = incrementCall(promptId, schemaMode, repairMode);
  if (mode === 'plugin-warning') {
    process.stderr.write('warning: codex_core_plugins::manifest interface.defaultPrompt contains /home/user/.codex/auth.json and sk-SECRET\\n');
  }
  if (mode === 'missing-output' && schemaMode) {
    process.stderr.write('warning: final output was empty; token sk-SECRET auth /home/user/.codex/auth.json\\n');
    process.exit(0);
  }
  let finalText = schemaMode ? JSON.stringify(jsonFor(promptId, mode, repairMode)) : textFor(promptId);
  if (mode === 'invalid-json' && schemaMode) finalText = '{"broken":';
  if (mode === 'retry-invalid-first' && schemaMode && !repairMode && callNumber === 1) finalText = '{"broken":';
  if (mode === 'repair-fails' && schemaMode) finalText = JSON.stringify({ unexpected: true });
  if (outputFile) fs.writeFileSync(outputFile, finalText);
  process.stdout.write(JSON.stringify({ type: 'thread.started', token: 'sk-SECRET', authFile: '/home/user/.codex/auth.json' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: finalText } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
  process.exit(0);
}
process.stderr.write('unknown fake codex command: ' + args.join(' ') + '\\n');
process.exit(2);

function incrementCall(promptId, schemaMode, repairMode) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    state = {};
  }
  const key = [promptId, schemaMode ? 'json' : 'text', repairMode ? 'repair' : 'normal'].join(':');
  state[key] = (state[key] || 0) + 1;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state[key];
}

function textFor(promptId) {
  const text = {
    'strategy.build_story_bible': '# Codex Story Bible\\n\\nA safe local Codex generated bible.\\n',
    'strategy.build_genre_contract': '# Codex Genre Contract\\n\\nMystery promises and boundaries.\\n',
    'strategy.build_reader_promise': '# Codex Reader Promise\\n\\nCuriosity, escalation, and fair reveals.\\n',
    'strategy.build_style_guide': '# Codex Style Guide\\n\\nLean suspense prose.\\n',
    'planning.plan_global_outline': '# Codex Global Outline\\n\\nA three chapter opening arc.\\n',
    'planning.plan_volume_outline': '# Codex Volume 01 Outline\\n\\nVolume one tracks the radio mystery.\\n',
    'planning.generate_global_outline_text': '# Codex Global Outline\\n\\nA three chapter opening arc around the radio signal.\\n',
    'planning.generate_volume_outline_text': '# Codex Volume 01 Outline\\n\\nChapter 1 wakes the radio, chapter 2 follows the elevator log, chapter 3 reaches the missing floor.\\n',
    'planning.validate_and_assemble': '# Codex Planning Validation\\n\\nArc map and chapter queue are consistent.\\n',
    'production.write_scene': 'Codex scene draft for the selected scene. The radio clicks once, then the old building answers.\\n'
    ,
    'revision.rewrite_chapter': '# The Radio Wakes\\n\\nLin Cheng listened as the powerless radio clicked once and named the old building. He wrote the address down, not yet knowing who had called.\\n',
    'revision.final_chapter': '# The Radio Wakes\\n\\nLin Cheng listened as the powerless radio clicked once and named the old building. He wrote the address down, not yet knowing who had called.\\n'
  };
  return text[promptId] || 'Codex text final\\n';
}

function jsonFor(promptId, mode, repairMode) {
  if (mode === 'schema-invalid') {
    return { unexpected: true };
  }
  if (mode === 'codex-controlled-invalid-patch' && promptId === 'memory.extract_canon_patch_proposal_slim') {
    return { unexpected: true };
  }
  if (mode === 'repair-schema-invalid' && !repairMode) {
    return { unexpected: true };
  }
  const json = {
    'planning.generate_arc_map_minimal_json': {
      arcs: [
        { id: 'arc_radio', name: 'Radio Signal', type: 'plot', summary: 'The signal pulls Lin Cheng toward the old building.' }
      ]
    },
    'planning.generate_chapter_queue_minimal_json': {
      chapters: [
        { chapterNumber: 1, title: 'The Radio Wakes', summary: 'The radio speaks without power.', primaryFunction: 'Open the impossible broadcast.', targetDebts: [] },
        { chapterNumber: 2, title: 'The Elevator Log', summary: 'The elevator records an impossible stop.', primaryFunction: 'Escalate the building mystery.', targetDebts: ['debt_radio_signal'] },
        { chapterNumber: 3, title: 'The Missing Floor', summary: 'Lin Cheng finds signs of a hidden floor.', primaryFunction: 'Create a strong midpoint hook.', targetDebts: ['debt_elevator_log'] }
      ]
    },
    'planning.plan_chapter_mission_slim': {
      chapterNumber: 1,
      chapterFunction: 'Open the mystery through the old radio.',
      objectives: ['Introduce the impossible broadcast.', 'Point the reader toward the old building.'],
      readerKnowledge: ['The radio can speak without power.'],
      readerQuestions: ['Who is calling through the radio?'],
      forbiddenMoves: ['Do not reveal the caller identity.']
    },
    'planning.generate_plan_candidates_slim': {
      chapterNumber: 1,
      candidates: [
        { id: 'plan_001', title: 'Signal First', summary: 'Start with the impossible broadcast.', markdown: '# Plan 001\\n\\nThe radio speaks and points to the old building.' },
        { id: 'plan_002', title: 'Building First', summary: 'Open at the old building.', markdown: '# Plan 002\\n\\nThe building hints before the radio.' },
        { id: 'plan_003', title: 'Memory First', summary: 'Open with a family memory.', markdown: '# Plan 003\\n\\nThe memory frames the radio.' }
      ]
    },
    'planning.rank_plan_candidates_slim': {
      chapterNumber: 1,
      selectedCandidateId: 'plan_001',
      rationale: 'Signal First gives the strongest hook with the lowest continuity risk.'
    },
    'planning.generate_scene_cards_slim': {
      scenes: [
        { purpose: 'Introduce the radio.', conflict: 'Rational doubt versus impossible sound.', entryPoint: 'Lin Cheng buys the radio.', exitPoint: 'The radio speaks without power.', location: 'Apartment', characters: ['char_lincheng'] },
        { purpose: 'Point toward the building.', conflict: 'Ignore the call or investigate.', entryPoint: 'The voice repeats an address.', exitPoint: 'Lin Cheng decides to go.', location: 'Street', characters: ['char_lincheng'] }
      ]
    },
    'diagnostics.diagnose_chapter_slim': {
      chapterNumber: 1,
      draftVersion: 1,
      passed: mode !== 'codex-controlled-diagnostics-fail',
      averageScore: mode === 'codex-controlled-diagnostics-fail' ? 5 : 8.6,
      issues: mode === 'codex-controlled-diagnostics-fail' ? ['timeline hard check failed'] : []
    },
    'revision.create_revision_plan_slim': {
      chapterNumber: 1,
      fromDraftVersion: 1,
      strategy: 'local_patch',
      operations: [
        {
          targetType: 'whole_chapter',
          sceneId: '',
          operation: 'tighten final wording',
          reason: 'Keep the chapter focused on the radio signal.',
          instruction: 'Preserve the radio hook and avoid revealing the caller.'
        }
      ],
      riskNotes: []
    },
    'memory.extract_canon_patch_proposal_slim': {
      chapterNumber: 1,
      sourceFinalPath: 'chapters/chapter_001/final.md',
      latestCommittedChapter: 1,
      newFacts: [
        {
          id: mode === 'codex-controlled-conflict' ? 'fact_ch001_radio_signal' : 'fact_codex_ch001_radio_signal',
          text: 'Lin Cheng hears a powerless radio name the old building.',
          sourceChapter: mode === 'codex-controlled-conflict' ? 2 : 1,
          type: 'event',
          readerVisible: true,
          authorVisible: true,
          visibleCharacterIds: ['char_lincheng'],
          confidence: 'explicit',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      characterStates: [],
      characterUpdates: [],
      timelineEvents: [
        {
          id: 'event_codex_ch001_radio_signal',
          chapter: mode === 'codex-controlled-conflict' ? 2 : 1,
          sceneId: 'scene_001',
          order: 1,
          summary: 'The powerless radio names the old building.',
          participants: ['char_lincheng'],
          location: 'Apartment',
          timestampLabel: 'chapter 1 night'
        }
      ],
      narrativeDebtUpdates: [],
      foreshadowingUpdates: [],
      readerStatePatch: {
        addKnows: ['The radio can speak without power.'],
        addSuspects: ['The old building is tied to the broadcast.'],
        addQuestions: ['Who is calling through the radio?'],
        removeQuestions: [],
        addExpectations: ['Lin Cheng will investigate the old building.'],
        addDoesNotKnow: []
      },
      relationshipUpdates: [],
      revealScheduleUpdates: []
    },
    'planning.generate_arc_map': {
      schemaVersion: '1.0',
      projectId: 'demo-novel',
      arcs: [
        { id: 'arc_radio', name: 'The Radio Signal', type: 'plot', summary: 'The signal points to the missing resident.', relatedCharacters: ['char_lincheng'], relatedThreads: ['thread_signal'] }
      ]
    },
    'planning.generate_chapter_queue': {
      schemaVersion: '1.0',
      projectId: 'demo-novel',
      chapters: [
        { chapterNumber: 1, title: 'The Radio Wakes', status: 'planned', currentStage: 'none', completedStages: [], summary: 'The radio speaks.', primaryFunction: 'Open the mystery.', targetDebts: [] },
        { chapterNumber: 2, title: 'The Elevator Log', status: 'planned', currentStage: 'none', completedStages: [], summary: 'The building answers.', primaryFunction: 'Escalate.', targetDebts: [] },
        { chapterNumber: 3, title: 'The Missing Floor', status: 'planned', currentStage: 'none', completedStages: [], summary: 'The clue narrows.', primaryFunction: 'Hook.', targetDebts: [] }
      ]
    },
    'planning.plan_chapter_mission': {
      id: 'mission_ch001_codex',
      chapterNumber: 1,
      chapterFunction: 'Open the mystery through the old radio.',
      requiredObjectives: [
        { id: 'obj_plot_001', text: 'Introduce the impossible broadcast.', type: 'plot', priority: 'must' }
      ],
      debtsToPayOrAdvance: [],
      debtsToIntroduce: [{ type: 'mystery', promise: 'Why does the radio speak without power?', importance: 8 }],
      characterDeltas: [{ characterId: 'char_lincheng', from: 'skeptical', to: 'alert', evidenceRequired: 'He hears the broadcast.' }],
      readerInformationDelta: { newKnowledge: ['The radio can speak without power.'], newSuspicions: ['The voice is tied to an old building.'], questionsToMaintain: ['Who is calling?'], questionsToAnswer: [] },
      forbiddenMoves: ['Do not reveal the caller identity.'],
      targetEmotionalCurve: ['unease', 'curiosity']
    },
    'planning.generate_plan_candidates': {
      chapterNumber: 1,
      candidates: [
        { id: 'plan_001', title: 'Signal First', summary: 'Start with the impossible broadcast.', markdown: '# Plan 001\\n\\nThe radio speaks and points to the old building.', strengths: ['Strong hook'], risks: [] },
        { id: 'plan_002', title: 'Building First', summary: 'Open at the old building.', markdown: '# Plan 002\\n\\nThe building hints before the radio.', strengths: ['Atmosphere'], risks: ['Slower hook'] },
        { id: 'plan_003', title: 'Memory First', summary: 'Open with a family memory.', markdown: '# Plan 003\\n\\nThe memory frames the radio.', strengths: ['Character'], risks: ['Less immediate'] }
      ]
    },
    'planning.rank_plan_candidates': {
      chapterNumber: 1,
      selectedCandidateId: 'plan_001',
      selectedPlanPath: 'chapters/chapter_001/plan_candidates/plan_001.md',
      rationale: 'Best hook and lowest continuity risk.',
      candidates: [
        { candidateId: 'plan_001', planPath: 'chapters/chapter_001/plan_candidates/plan_001.md', scores: { plot_progression: 8, character_arc_value: 7, tension_potential: 8, continuity_risk: 2, reader_hook_strength: 9, genre_satisfaction: 8 }, totalScore: 8, strengths: ['Hook'], risks: [] },
        { candidateId: 'plan_002', planPath: 'chapters/chapter_001/plan_candidates/plan_002.md', scores: { plot_progression: 7, character_arc_value: 6, tension_potential: 7, continuity_risk: 4, reader_hook_strength: 7, genre_satisfaction: 7 }, totalScore: 7, strengths: ['Mood'], risks: ['Pacing'] },
        { candidateId: 'plan_003', planPath: 'chapters/chapter_001/plan_candidates/plan_003.md', scores: { plot_progression: 6, character_arc_value: 8, tension_potential: 6, continuity_risk: 3, reader_hook_strength: 6, genre_satisfaction: 7 }, totalScore: 6.8, strengths: ['Character'], risks: ['Slow'] }
      ]
    },
    'planning.generate_scene_cards': [
      { sceneId: 'scene_001', chapterNumber: 1, order: 1, purpose: 'Introduce the radio.', conflict: 'Rational doubt versus impossible sound.', entryPoint: 'Lin Cheng buys the radio.', exitPoint: 'The radio speaks without power.', characters: ['char_lincheng'], location: 'Apartment', time: 'Night', informationDelta: ['Radio works without power.'], emotionalShift: 'calm to disturbed', readerEffect: 'curiosity', constraints: ['No identity reveal'], beats: ['Purchase', 'Static', 'Voice'] },
      { sceneId: 'scene_002', chapterNumber: 1, order: 2, purpose: 'Point toward the building.', conflict: 'Ignore the call or investigate.', entryPoint: 'The voice repeats an address.', exitPoint: 'Lin Cheng decides to go.', characters: ['char_lincheng'], location: 'Street', time: 'Late night', informationDelta: ['Address exists.'], emotionalShift: 'disturbed to compelled', readerEffect: 'hook', constraints: ['No final answer'], beats: ['Address', 'Search', 'Decision'] }
    ],
    'diagnostics.diagnose_chapter': {
      chapterNumber: 1,
      draftVersion: 1,
      hard_checks: {
        timeline_consistency: { passed: true, message: 'ok' },
        character_knowledge_consistency: { passed: true, message: 'ok' },
        world_rule_consistency: { passed: true, message: 'ok' },
        no_unplanned_reveal: { passed: true, message: 'ok' }
      },
      soft_scores: { plot_progression: 8, character_consistency: 8, tension_curve: 8, emotional_impact: 8, chapter_hook: 8, style_match: 8, genre_satisfaction: 8, reader_curiosity: 8 },
      scores: { total: 8, plotProgression: 8, characterConsistency: 8, tensionCurve: 8, emotionalImpact: 8, hookStrength: 8, styleMatch: 8, genreSatisfaction: 8, readerCuriosity: 8, proseQuality: 8 },
      missionSatisfaction: { allRequiredSatisfied: true, objectiveResults: [{ objectiveId: 'obj_plot_001', satisfied: true, evidence: 'radio speaks' }] },
      issues: []
    },
    'memory.extract_canon_patch': {
      chapterNumber: 1,
      sourceFinalPath: 'chapters/chapter_001/final.md',
      readerStatePatch: {}
    },
    'provider.test_json': { title: 'Codex JSON', ok: true, items: ['alpha', 'beta'] },
    'provider.health': { ok: true }
  };
  return json[promptId] || { title: 'Codex JSON', ok: true, items: ['alpha', 'beta'] };
}
`,
    'utf8'
  );
  await chmod(codexBin, 0o755);
  return { codexBin, argsLogPath };
}
