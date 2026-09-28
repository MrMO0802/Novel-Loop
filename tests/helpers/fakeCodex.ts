import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FakeCodexMode =
  | 'valid'
  | 'upgrade-required'
  | 'jsonl-usage-limit'
  | 'jsonl-login-required'
  | 'invalid-json'
  | 'schema-invalid'
  | 'doctor-unhealthy'
  | 'slim-valid'
  | 'retry-invalid-first'
  | 'repair-schema-invalid'
  | 'repair-fails'
  | 'plugin-warning'
  | 'missing-output'
  | 'slow-timeout'
  | 'codex-controlled-valid'
  | 'codex-controlled-invalid-patch'
  | 'codex-controlled-conflict'
  | 'codex-controlled-diagnostics-fail'
  | 'codex-controlled-normalization-warning'
  | 'codex-targeted-revision'
  | 'codex-targeted-revision-no-improvement'
  | 'codex-targeted-revision-scope-violation'
  | 'codex-expanded-target-revision'
  | 'codex-expanded-target-multi-delete'
  | 'codex-expanded-target-incomplete'
  | 'codex-expanded-target-residual-time'
  | 'codex-expanded-target-residual-duplicate'
  | 'codex-expanded-target-quality-regression'
  | 'codex-candidate-preview'
  | 'codex-mission-non-default-character'
  | 'codex-mission-unknown-character'
  | 'codex-mission-unknown-debt'
  | 'codex-mission-duplicate-debt'
  | 'codex-mission-resolved-debt'
  | 'codex-scene-non-default-character'
  | 'codex-scene-unknown-character'
  | 'codex-scene-display-name'
  | 'codex-scene-empty-characters'
  | 'codex-scene-over-limit'
  | 'pause-on-mission';

export async function writeFakeCodex(root: string, mode: FakeCodexMode = 'valid'): Promise<{
  codexBin: string;
  argsLogPath: string;
  statePath: string;
  pausePath: string;
  releasePath: string;
}> {
  const codexBin = path.join(root, `fake-codex-${mode}.cjs`);
  const argsLogPath = path.join(root, `fake-codex-${mode}.log`);
  const statePath = path.join(root, `fake-codex-${mode}.state.json`);
  const pausePath = path.join(root, `fake-codex-${mode}.paused`);
  const releasePath = path.join(root, `fake-codex-${mode}.release`);
  await writeFile(
    codexBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argsLogPath)}, args.join(' ') + '\\n');
const mode = ${JSON.stringify(mode)};
const statePath = ${JSON.stringify(statePath)};
const pausePath = ${JSON.stringify(pausePath)};
const releasePath = ${JSON.stringify(releasePath)};
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
  fs.appendFileSync(${JSON.stringify(`${codexBin}.stdin.ndjson`)}, JSON.stringify(stdin) + '\\n');
  if (['upgrade-required', 'jsonl-usage-limit', 'jsonl-login-required'].includes(mode)) {
    const message = {
      'upgrade-required': "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      'jsonl-usage-limit': 'You have reached your usage limit.',
      'jsonl-login-required': 'Not logged in. Run codex login.'
    }[mode] + ' sk-SECRET Bearer secret123 /home/user/.codex/auth.json';
    const error = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message } });
    process.stdout.write(JSON.stringify({ type: 'error', message: error }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: error } }) + '\\n');
    process.stderr.write('Warning: no last agent message');
    process.exit(1);
  }
  const outputIndex = args.indexOf('--output-last-message');
  const outputFile = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const schemaMode = args.includes('--output-schema');
  const promptId = (stdin.match(/PROMPT_ID:\\s*([^\\n]+)/) || [])[1] || 'unknown';
  const repairMode = stdin.includes('REPAIR_JSON_ONLY');
  const callNumber = incrementCall(promptId, schemaMode, repairMode);
  if (mode === 'pause-on-mission' && promptId === 'planning.plan_chapter_mission_slim' && callNumber === 1) {
    fs.writeFileSync(pausePath, 'paused\\n');
    while (!fs.existsSync(releasePath)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  if (mode === 'slow-timeout') {
    setTimeout(() => {
      if (outputFile) fs.writeFileSync(outputFile, schemaMode ? JSON.stringify({ ok: true }) : 'too late\\n');
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'too late' } }) + '\\n');
      process.exit(0);
    }, 2000);
    return;
  }
  if (mode === 'plugin-warning') {
    process.stderr.write('warning: codex_core_plugins::manifest interface.defaultPrompt contains /home/user/.codex/auth.json and sk-SECRET\\n');
  }
  if (mode === 'missing-output' && schemaMode) {
    process.stderr.write('warning: final output was empty; token sk-SECRET auth /home/user/.codex/auth.json\\n');
    process.exit(0);
  }
  let finalText = schemaMode ? JSON.stringify(jsonFor(promptId, mode, repairMode, stdin)) : textFor(promptId, stdin);
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

function textFor(promptId, stdin) {
  const chapterNumber = chapterFromPrompt(stdin);
  const nnn = formatChapter(chapterNumber);
  const chapterTitle = chapterNumber === 1 ? 'The Radio Wakes' : chapterNumber === 2 ? 'The Elevator Log' : 'The Missing Floor';
  const chapterBody =
    chapterNumber === 1
      ? 'Lin Cheng listened as the powerless radio clicked once and named the old building. He wrote the address down, not yet knowing who had called.'
      : chapterNumber === 2
        ? 'After the powerless radio named the old building, Lin Cheng found the elevator log marking a stop that did not exist. The old question about the caller sharpened into a route upward.'
        : 'After the elevator log exposed the impossible stop, Lin Cheng reached the missing floor and understood the building had been answering the radio all along.';
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
    'production.write_scene': 'Codex scene draft for chapter ' + chapterNumber + '. The radio clue and building record advance together.\\n'
    ,
    'revision.rewrite_chapter': '# ' + chapterTitle + '\\n\\n' + chapterBody + '\\n',
    'revision.final_chapter': '# ' + chapterTitle + '\\n\\n' + chapterBody + '\\n'
  };
  return text[promptId] || 'Codex text final\\n';
}

function jsonFor(promptId, mode, repairMode, stdin) {
  if (promptId === 'revision.desktop_diagnostic_revision') {
    const source = stdin.split('CHECKED DRAFT:\\n')[1]?.split('\\n\\nNUMBERED ISSUES:')[0] || '# Chapter 001 Draft';
    return { markdown: source + '\\n\\nDIAGNOSTIC_REVISION_CANDIDATE: 红伞位置已统一。', changes: [{ issueIndex: 0, reason: '统一重复事件细节，仍需重新检查。' }] };
  }
  const chapterNumber = chapterFromPrompt(stdin);
  const nnn = formatChapter(chapterNumber);
  const previousNnn = formatChapter(Math.max(1, chapterNumber - 1));
  const missionCharacterId =
    mode === 'codex-mission-non-default-character'
      ? 'char_mara'
      : mode === 'codex-mission-unknown-character'
        ? 'char_unknown'
        : missionCharacterFromPrompt(stdin);
  const effectiveMissionCharacterId = missionCharacterId ?? 'char_lincheng';
  const missionDebts =
    mode === 'codex-mission-unknown-debt'
      ? ['debt_unknown']
      : mode === 'codex-mission-duplicate-debt'
        ? ['debt_open', 'debt_open']
        : mode === 'codex-mission-resolved-debt'
          ? ['debt_resolved']
          : [];
  const sceneCharacterId = sceneCharacterFromPrompt(stdin);
  const sceneCharacters =
    mode === 'codex-scene-unknown-character'
      ? ['char_unknown']
      : mode === 'codex-scene-display-name'
        ? ['Mara Vale']
        : mode === 'codex-scene-empty-characters'
          ? []
          : sceneCharacterId === undefined
            ? []
            : [sceneCharacterId];
  const chapterTitle = chapterNumber === 1 ? 'The Radio Wakes' : chapterNumber === 2 ? 'The Elevator Log' : 'The Missing Floor';
  const chapterFact =
    chapterNumber === 1
      ? 'Lin Cheng hears a powerless radio name the old building.'
      : chapterNumber === 2
        ? 'Lin Cheng follows the elevator log after the powerless radio names the old building.'
        : 'Lin Cheng reaches the missing floor after the elevator log exposes the impossible stop.';
  const sourceFinalPath = ((stdin.match(/<source_final_path>\\s*([^<]+)\\s*<\\/source_final_path>/) || [])[1] || 'chapters/chapter_' + nnn + '/final.md').trim();
  const enhancedDiagnosticsContext = stdin.includes('DIAGNOSTICS_CONTEXT_MODE: enhanced');
  if (mode === 'schema-invalid') {
    return { unexpected: true };
  }
  if (mode === 'codex-controlled-invalid-patch' && promptId === 'memory.extract_canon_patch_proposal_slim') {
    return { unexpected: true };
  }
  if (mode === 'repair-schema-invalid' && !repairMode) {
    return { unexpected: true };
  }
  if (promptId === 'revision.targeted_revision_operations_slim' && mode === 'codex-targeted-revision-scope-violation') {
    return {
      operations: [
        {
          operationId: 'operation_outside_scope',
          operationType: 'replace_paragraph',
          targetIds: ['target_p999'],
          replacementText: 'Unauthorized paragraph replacement.',
          reason: 'Exercise the local scope gate.',
          expectedEffect: 'This operation must be rejected.',
          rulesAddressed: ['duplicate_event_repetition', 'same_event_same_day_explicit_time_conflict', 'mission_plan_time_mismatch'],
          factsPreserved: [],
          newFactsIntroduced: []
        }
      ]
    };
  }
  if (promptId === 'revision.targeted_revision_operations_slim' && (mode === 'codex-targeted-revision' || mode === 'codex-targeted-revision-no-improvement')) {
    const targetIds = [...stdin.matchAll(/"targetId"\\s*:\\s*"([^"]+)"/g)].map((match) => match[1]);
    const first = targetIds[0] || 'target_p002';
    const duplicate = targetIds[Math.min(2, Math.max(0, targetIds.length - 1))] || first;
    return {
      operations: [
        {
          operationId: 'operation_align_daytime',
          operationType: 'replace_paragraph',
          targetIds: [first],
          replacementText: '午高峰的新单挤进手机，林澈确认这是同一趟白天配送。',
          reason: 'Keep the delivery in the mission-required daytime window.',
          expectedEffect: 'Remove the incompatible late-night framing.',
          rulesAddressed: ['same_event_same_day_explicit_time_conflict', 'mission_plan_time_mismatch'],
          factsPreserved: ['The same order and recipient remain unchanged.'],
          newFactsIntroduced: []
        },
        {
          operationId: 'operation_remove_duplicate_handoff',
          operationType: 'replace_paragraph',
          targetIds: [duplicate],
          replacementText: '林澈没有再次递餐，只把视线越过已经合上的门，投向楼梯间上方。',
          reason: 'Remove the second delivery action while preserving the floor clue.',
          expectedEffect: 'Leave one delivery handoff in the chapter.',
          rulesAddressed: ['duplicate_event_repetition'],
          factsPreserved: ['The seventeenth-floor clue remains unchanged.'],
          newFactsIntroduced: []
        }
      ]
    };
  }
  if (promptId === 'revision.targeted_revision_operations_slim' && mode.startsWith('codex-expanded-target-')) {
    return expandedTargetOperations(stdin, mode);
  }
  if (promptId === 'diagnostics.diagnose_chapter_slim' && mode === 'codex-targeted-revision') {
    return targetedDiagnostics(chapterNumber, /EXPERIMENT_ARM:\\s*A\\d+/.test(stdin));
  }
  if (promptId === 'diagnostics.diagnose_chapter_slim' && mode === 'codex-targeted-revision-no-improvement') {
    return targetedDiagnostics(chapterNumber, true, /EXPERIMENT_ARM:\\s*B\\d+/.test(stdin));
  }
  if (promptId === 'diagnostics.diagnose_chapter_slim' && mode.startsWith('codex-expanded-target-')) {
    const candidate = /EXPERIMENT_ARM:\\s*B\\d+/.test(stdin) || /draft_targeted_revision_candidate_v2\\.md/.test(stdin);
    return targetedDiagnostics(chapterNumber, !candidate, false, candidate && stdin.includes('文气突然断裂') ? 4.8 : undefined);
  }
  const currentMissionMatch = stdin.match(
    /<current_mission>\\s*([\\s\\S]*?)\\s*<\\/current_mission>/
  );
  let adjustedMission = null;
  if (currentMissionMatch) {
    try {
      const currentMission = JSON.parse(currentMissionMatch[1]);
      adjustedMission = {
        ...currentMission,
        targetWordCount: currentMission.targetWordCount ?? null
      };
    } catch {}
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
      chapterNumber,
      chapterFunction: chapterNumber === 1 ? 'Open the mystery through the old radio.' : 'Advance the radio-building mystery using committed continuity.',
      objectives: ['Advance chapter ' + chapterNumber + ' using prior committed Story State.', chapterFact],
      debtsToPayOrAdvance: missionDebts,
      debtsToIntroduce: [{
        type: 'mystery',
        promise: 'Why does the radio speak without power?',
        importance: 8
      }],
      participatingCharacterIds: [effectiveMissionCharacterId],
      charactersToIntroduce: missionCharacterId === undefined ? [{
        characterId: 'char_lincheng',
        name: 'Lin Cheng',
        role: 'protagonist'
      }] : [],
      characterDeltas: [{
        characterId: effectiveMissionCharacterId,
        from: 'skeptical',
        to: 'alert',
        evidenceRequired: 'He hears the broadcast without a power source.'
      }],
      readerKnowledge: ['Chapter ' + chapterNumber + ' reveals: ' + chapterFact],
      readerQuestions: ['What does chapter ' + chapterNumber + ' imply for the building?'],
      forbiddenMoves: ['Do not reveal the final caller identity.']
    },
    'planning.adjust_chapter_mission_slim': adjustedMission,
    'planning.generate_plan_candidates_slim': {
      chapterNumber,
      candidates: [
        { id: 'plan_001', title: 'Continuity First', summary: 'Use the prior clue to advance chapter ' + chapterNumber + '.', markdown: '# Plan 001\\n\\nChapter ' + chapterNumber + ' advances from prior Codex facts.' },
        { id: 'plan_002', title: 'Building First', summary: 'Open at the old building.', markdown: '# Plan 002\\n\\nThe building hints before the radio.' },
        { id: 'plan_003', title: 'Memory First', summary: 'Open with a family memory.', markdown: '# Plan 003\\n\\nThe memory frames the radio.' }
      ]
    },
    'planning.adjust_plan_candidate_slim': {
      title: '事故现场先行',
      markdown: '# 事故现场先行\\n\\n先展示重复事故现场，再让林澈核对被改写的记录。\\n',
      changeSummary: ['把开场提前到事故现场。'],
      preservedConstraints: ['不新增人物。', '不揭示幕后主使。']
    },
    'planning.rank_plan_candidates_slim': {
      chapterNumber,
      selectedCandidateId: 'plan_001',
      rationale: 'Signal First gives the strongest hook with the lowest continuity risk.'
    },
    'planning.generate_scene_cards_slim': {
      scenes: [
        { purpose: 'Introduce the radio.', conflict: 'Rational doubt versus impossible sound.', entryPoint: 'The protagonist buys the radio.', exitPoint: 'The radio speaks without power.', location: 'Apartment', characters: sceneCharacters },
        { purpose: 'Point toward the building.', conflict: 'Ignore the call or investigate.', entryPoint: 'The voice repeats an address.', exitPoint: 'The protagonist decides to go.', location: 'Street', characters: sceneCharacters },
        ...(mode === 'codex-scene-over-limit'
          ? [{ purpose: 'Repeat the hook.', conflict: 'The same decision repeats.', entryPoint: 'The radio speaks again.', exitPoint: 'The protagonist repeats the choice.', location: 'Street', characters: sceneCharacters }]
          : [])
      ]
    },
    'diagnostics.diagnose_chapter_slim': {
      chapterNumber,
      draftVersion: 1,
      passed: mode !== 'codex-controlled-diagnostics-fail',
      averageScore: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
      hardChecks: [
        {
          checkName: 'timeline_consistency',
          result: mode === 'codex-controlled-diagnostics-fail' ? 'fail' : 'pass',
          blocking: mode === 'codex-controlled-diagnostics-fail',
          evidence: mode === 'codex-controlled-diagnostics-fail' && enhancedDiagnosticsContext ? 'draft timestamps conflict with chapter mission sequence' : '',
          explanation:
            mode === 'codex-controlled-diagnostics-fail'
              ? enhancedDiagnosticsContext
                ? 'confirmed contradiction: timeline conflict remains after enhanced context'
                : 'timeline hard check failed without detailed evidence'
              : 'No timeline contradiction found.'
        },
        {
          checkName: 'character_knowledge_consistency',
          result: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'fail' : 'pass',
          blocking: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext,
          evidence: '',
          explanation: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'character knowledge hard check failed without detailed evidence' : 'No character knowledge contradiction found.'
        },
        {
          checkName: 'world_rule_consistency',
          result: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'fail' : 'pass',
          blocking: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext,
          evidence: '',
          explanation: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'world rule hard check failed without detailed evidence' : 'No world rule contradiction found.'
        },
        {
          checkName: 'no_unplanned_reveal',
          result: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'fail' : 'pass',
          blocking: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext,
          evidence: '',
          explanation: mode === 'codex-controlled-diagnostics-fail' && !enhancedDiagnosticsContext ? 'unplanned reveal hard check failed without detailed evidence' : 'No unplanned reveal found.'
        }
      ],
      softScores: {
        plot_progression: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        character_consistency: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        tension_curve: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        emotional_impact: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        chapter_hook: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        style_match: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        genre_satisfaction: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6,
        reader_curiosity: mode === 'codex-controlled-diagnostics-fail' ? 5 : mode === 'codex-controlled-normalization-warning' ? 4.2 : 8.6
      },
      diagnostics:
        mode === 'codex-controlled-diagnostics-fail'
          ? [
              {
                type: 'timeline',
                severity: enhancedDiagnosticsContext ? 'high' : 'medium',
                message: enhancedDiagnosticsContext ? 'timeline inconsistency confirmed by draft timestamps and mission context' : 'timeline evidence is incomplete',
                evidence: enhancedDiagnosticsContext ? 'draft timestamps conflict with chapter mission sequence' : '',
                recommendation: enhancedDiagnosticsContext ? 'Align the draft timestamps before commit.' : 'Collect canonical timeline evidence.'
              }
            ]
          : [],
      revisionRequired: mode === 'codex-controlled-diagnostics-fail'
    },
    'revision.create_revision_plan_slim': {
      chapterNumber,
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
      chapterNumber,
      sourceFinalPath,
      latestCommittedChapter: chapterNumber,
      newFacts: [
        {
          id: mode === 'codex-controlled-conflict' ? 'fact_ch001_radio_signal' : 'fact_codex_ch' + nnn + '_radio_signal',
          text: chapterFact,
          sourceChapter: mode === 'codex-controlled-conflict' ? chapterNumber + 1 : chapterNumber,
          type: 'event',
          readerVisible: true,
          authorVisible: true,
          visibleCharacterIds: ['char_lincheng'],
          confidence: 'explicit',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      characterStates: [{ characterId: 'char_lincheng', summary: 'Lin Cheng is tracking the chapter ' + chapterNumber + ' building clue.' }],
      characterUpdates: [{ characterId: 'char_lincheng', field: 'currentGoal', oldValueSummary: '', newValue: 'Follow the chapter ' + chapterNumber + ' building clue.', reason: 'Chapter ' + chapterNumber + ' advances the investigation.' }],
      timelineEvents: [
        {
          id: 'event_codex_ch' + nnn + '_radio_signal',
          chapter: mode === 'codex-controlled-conflict' ? chapterNumber + 1 : chapterNumber,
          sceneId: 'scene_001',
          order: 1,
          summary: chapterFact,
          participants: ['char_lincheng'],
          location: chapterNumber === 1 ? 'Apartment' : 'Old Building',
          timestampLabel: 'chapter ' + chapterNumber + ' night'
        }
      ],
      narrativeDebtUpdates: chapterNumber === 1 ? [{ debtId: 'debt_codex_ch001_radio_signal', action: 'create', text: 'Who is calling through the radio?' }] : [{ debtId: 'debt_codex_ch001_radio_signal', action: chapterNumber === 2 ? 'partially_pay' : 'pay', text: 'The chapter ' + chapterNumber + ' clue advances the prior mystery from chapter ' + previousNnn + '.' }],
      foreshadowingUpdates: chapterNumber === 1 ? [{ foreshadowingId: 'foreshadow_codex_ch001_building', action: 'create', text: 'The old building answers the powerless radio.' }] : [{ foreshadowingId: 'foreshadow_codex_ch001_building', action: chapterNumber === 2 ? 'reinforce' : 'partially_pay', text: 'The building clue returns in chapter ' + chapterNumber + '.' }],
      readerStatePatch: {
        addKnows: ['Chapter ' + chapterNumber + ': ' + chapterFact],
        addSuspects: ['The old building clue from chapter ' + chapterNumber + ' is connected to the broadcast.'],
        addQuestions: ['What does chapter ' + chapterNumber + ' reveal about the caller?'],
        removeQuestions: [],
        addExpectations: ['Chapter ' + (chapterNumber + 1) + ' will build on chapter ' + chapterNumber + '.'],
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
      charactersToIntroduce: [{
        characterId: 'char_lincheng',
        name: 'Lin Cheng',
        role: 'protagonist'
      }],
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
  return json[promptId] || { title: 'Codex Boundary Smoke', ok: true, summary: 'Fake Codex returned schema-constrained JSON.' };
}

function targetedDiagnostics(chapterNumber, timelineFailed, residualCandidate = false, forcedScore) {
  const timelinePassed = !timelineFailed;
  const timelineEvidence = residualCandidate
    ? '任务要求白天送餐，但出门时间仍为二十三点二十九分；十六楼的门又开了，住户再次接过同一个餐袋并再次关门。'
    : '同一订单先在午高峰交付，随后记录二十三点十七分和二十三点二十九分；住户接餐关门后又重复开门、接餐和关门。';
  const hardChecks = ['timeline_consistency', 'character_knowledge_consistency', 'world_rule_consistency', 'no_unplanned_reveal'].map((checkName) => ({
    checkName,
    result: checkName === 'timeline_consistency' && !timelinePassed ? 'fail' : 'pass',
    blocking: checkName === 'timeline_consistency' && !timelinePassed,
    evidence: checkName === 'timeline_consistency' && !timelinePassed ? timelineEvidence : '',
    explanation: checkName === 'timeline_consistency' && !timelinePassed ? 'confirmed contradiction in baseline draft' : 'No contradiction found.'
  }));
  return {
    chapterNumber,
    draftVersion: 1,
    passed: forcedScore === undefined ? timelinePassed : false,
    averageScore: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
    hardChecks,
    softScores: {
      plot_progression: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      character_consistency: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      tension_curve: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      emotional_impact: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      chapter_hook: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      style_match: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      genre_satisfaction: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore,
      reader_curiosity: forcedScore === undefined ? (timelinePassed ? 8.4 : 6.2) : forcedScore
    },
    diagnostics: timelinePassed ? [] : [{ type: 'timeline', severity: 'high', message: 'baseline timeline conflict', evidence: 'same order repeated at incompatible times', recommendation: 'Apply only the adjudicated revision.' }],
    revisionRequired: !timelinePassed
  };
}

function expandedTargetOperations(stdin, mode) {
  let allowedTargets = [];
  const allowedMatch = /Allowed targets:\\s*([\\s\\S]*?)\\n\\nFacts to preserve:/.exec(stdin);
  try {
    allowedTargets = allowedMatch ? JSON.parse(allowedMatch[1]) : [];
  } catch {
    allowedTargets = [];
  }
  const allTargetIds = [...new Set(allowedTargets.map((target) => target.targetId))]
    .sort((left, right) => targetNumber(left) - targetNumber(right));
  const requiredTargetIds = allowedTargets
    .filter((target) => target.requiredForClosure === true)
    .map((target) => target.targetId)
    .sort((left, right) => targetNumber(left) - targetNumber(right));
  const lateExit = requiredTargetIds[requiredTargetIds.length - 1] || allTargetIds[allTargetIds.length - 1] || 'target_p014';
  const duplicateRequired = requiredTargetIds.filter((targetId) => targetId !== lateExit);
  const duplicateMin = Math.min(...duplicateRequired.map(targetNumber));
  const duplicateMax = Math.max(...duplicateRequired.map(targetNumber));
  const duplicateTargets = allTargetIds.filter((targetId) => targetNumber(targetId) >= duplicateMin && targetNumber(targetId) <= duplicateMax);
  const earlierTargets = allTargetIds.filter((targetId) => targetNumber(targetId) < targetNumber(lateExit));
  const lateEntry = earlierTargets[earlierTargets.length - 1] || lateExit;
  const duplicateReplacement = mode === 'codex-expanded-target-residual-duplicate'
    ? '十六楼的门又开了，住户再次接过同一个餐袋，随后门再次合上。'
    : mode === 'codex-expanded-target-quality-regression'
      ? '住户已经收好餐袋，提到十七楼曾有人失踪，又立刻否认；文气突然断裂，林澈追问后，门在他面前合上。'
      : '住户已经收好餐袋，提到十七楼曾有人失踪，又立刻否认；林澈追问后，门在他面前合上。';
  const timeReplacement = mode === 'codex-expanded-target-residual-time'
    ? '出门时间，二十三点二十九分。'
    : '进出记录：这次白天送餐在午间完成。';
  const operations = [
    {
      operationId: 'operation_merge_duplicate_sequence',
      operationType: 'merge_target_paragraphs',
      targetIds: duplicateTargets,
      replacementText: duplicateReplacement,
      reason: 'Collapse the approved duplicate opening, handoff, dialogue, and closing sequence while preserving the disappearance clue.',
      expectedEffect: 'Leave one delivery handoff and one continuous resident exchange.',
      rulesAddressed: ['duplicate_event_repetition'],
      factsPreserved: ['The resident mentions the seventeenth-floor disappearance and withdraws the statement.'],
      newFactsIntroduced: []
    },
    {
      operationId: 'operation_merge_daytime_record',
      operationType: 'merge_target_paragraphs',
      targetIds: [...new Set([lateEntry, lateExit])],
      replacementText: timeReplacement,
      reason: 'Align both approved time-record endpoints with the mission-required daytime delivery.',
      expectedEffect: 'Remove the late-night entry and exit references for the same delivery.',
      rulesAddressed: ['same_event_same_day_explicit_time_conflict', 'mission_plan_time_mismatch'],
      factsPreserved: ['Lin Che records the route after leaving the building.'],
      newFactsIntroduced: []
    }
  ];
  if (mode === 'codex-expanded-target-multi-delete') {
    return {
      operations: [
        {
          operationId: 'operation_delete_duplicate_sequence',
          operationType: 'delete_duplicate_paragraph',
          targetIds: duplicateTargets,
          replacementText: '',
          reason: 'Delete the approved repeated opening, handoff, dialogue, and closing sequence.',
          expectedEffect: 'Leave only the earlier delivery handoff while preserving canonical facts outside the duplicate sequence.',
          rulesAddressed: ['duplicate_event_repetition'],
          factsPreserved: ['The earlier delivery handoff remains canonical.'],
          newFactsIntroduced: []
        },
        operations[1]
      ]
    };
  }
  if (mode === 'codex-expanded-target-incomplete') return { operations: operations.slice(1) };
  return { operations };
}

function targetNumber(targetId) {
  return Number.parseInt((/p(\\d+)$/.exec(targetId) || [])[1] || '0', 10);
}

function chapterFromPrompt(stdin) {
  const tagged = /<chapter_number>\\s*(\\d+)\\s*<\\/chapter_number>/i.exec(stdin);
  if (tagged) return Number.parseInt(tagged[1], 10);
  const plain = /CHAPTER_NUMBER:\\s*(\\d+)/i.exec(stdin);
  if (plain) return Number.parseInt(plain[1], 10);
  return 1;
}

function missionCharacterFromPrompt(stdin) {
  const summary = /<story_state_summary>\\s*([\\s\\S]*?)\\s*<\\/story_state_summary>/i.exec(stdin);
  if (!summary) return undefined;
  const characters = /"characters"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*"(?:projectBriefSummary|openDebts)"/.exec(summary[1]);
  if (!characters) return undefined;
  const characterId = /"id"\\s*:\\s*"([^"]+)"/.exec(characters[1]);
  return characterId ? characterId[1] : undefined;
}

function sceneCharacterFromPrompt(stdin) {
  const refs = /<mission_character_refs>\\s*([\\s\\S]*?)\\s*<\\/mission_character_refs>/i.exec(stdin);
  if (refs) {
    const characterId = /\"([^\"]+)\"/.exec(refs[1]);
    if (characterId) return characterId[1];
  }
  const mission = /<mission_summary>\\s*([\\s\\S]*?)\\s*<\\/mission_summary>/i.exec(stdin);
  if (!mission) return undefined;
  const characterId = /\"characterId\"\\s*:\\s*\"([^\"]+)\"/.exec(mission[1]);
  return characterId ? characterId[1] : undefined;
}

function formatChapter(chapterNumber) {
  return String(chapterNumber).padStart(3, '0');
}
`,
    'utf8'
  );
  await chmod(codexBin, 0o755);
  return { codexBin, argsLogPath, statePath, pausePath, releasePath };
}
