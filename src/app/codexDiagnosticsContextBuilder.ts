import path from 'node:path';

import {
  ChapterMissionSchema,
  DiagnosticsContextManifestSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ChapterMission,
  DiagnosticsContextManifest,
  DiagnosticsContextMode,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface BuildDiagnosticsContextManifestInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  mode: DiagnosticsContextMode;
  contextBudgetBytes?: number;
  draftPath?: string;
}

export interface BuildDiagnosticsContextManifestResult {
  manifest: DiagnosticsContextManifest;
  manifestPath: string;
  markdownPath: string;
  promptContext: string;
}

interface ContextArtifactCandidate {
  name: string;
  path: string;
  artifactType: string;
  text: string;
  present: boolean;
  includeInBaseline: boolean;
  includeInEnhanced: boolean;
  reason: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_CONTEXT_BUDGET_BYTES = 24_000;

export const DIAGNOSTICS_REQUIRED_CONTEXT_ARTIFACTS = [
  'story_state summary',
  'character_states',
  'timeline',
  'reader_state',
  'open narrative debts',
  'unresolved foreshadowing',
  'selected plan',
  'chapter mission',
  'chapter draft'
];

export async function buildDiagnosticsContextManifest(
  input: BuildDiagnosticsContextManifestInput,
  fileStore = new FileStore()
): Promise<BuildDiagnosticsContextManifestResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const beforeState = await readOptionalText(paths.storyState(), fileStore);
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const candidates = await buildCandidates(paths, fileStore, input.chapterNumber, storyState, input.draftPath);
  const included = candidates.filter((candidate) => candidate.present && shouldInclude(input.mode, candidate));
  const excluded = candidates.filter((candidate) => !candidate.present || !shouldInclude(input.mode, candidate));
  const missingRequiredArtifacts = candidates
    .filter((candidate) => DIAGNOSTICS_REQUIRED_CONTEXT_ARTIFACTS.includes(candidate.name) && (!candidate.present || !shouldInclude(input.mode, candidate)))
    .map((candidate) => candidate.name);
  const promptContext = renderPromptContext(input.mode, included, input.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES);
  const contextBytes = byteLength(promptContext);
  const contextBudgetBytes = input.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  const truncated = contextBytes > contextBudgetBytes;
  const finalPromptContext = truncated ? promptContext.slice(0, contextBudgetBytes) : promptContext;
  const versioned = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'diagnostics_context_manifest');
  const manifest = await fileStore.writeJson(
    versioned.jsonPath,
    {
      reportId: `diagnostics_context_manifest_ch${formatChapterNumber(input.chapterNumber)}_v${versioned.version}`,
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      generatedAt: new Date().toISOString(),
      mode: input.mode,
      includedArtifacts: included.map((artifact) => toManifestArtifact(artifact, true)),
      excludedArtifacts: excluded.map((artifact) => toManifestArtifact(artifact, false)),
      requiredArtifacts: DIAGNOSTICS_REQUIRED_CONTEXT_ARTIFACTS,
      missingRequiredArtifacts,
      contextBytes: byteLength(finalPromptContext),
      contextBudgetBytes,
      contextTruncated: truncated,
      storyStateSummaryIncluded: included.some((artifact) => artifact.name === 'story_state summary'),
      characterStatesIncluded: included.some((artifact) => artifact.name === 'character_states'),
      timelineIncluded: included.some((artifact) => artifact.name === 'timeline'),
      readerStateIncluded: included.some((artifact) => artifact.name === 'reader_state'),
      openDebtsIncluded: included.some((artifact) => artifact.name === 'open narrative debts'),
      unresolvedForeshadowingIncluded: included.some((artifact) => artifact.name === 'unresolved foreshadowing'),
      selectedPlanIncluded: included.some((artifact) => artifact.name === 'selected plan'),
      missionIncluded: included.some((artifact) => artifact.name === 'chapter mission'),
      draftIncluded: included.some((artifact) => artifact.name === 'chapter draft'),
      warnings: buildWarnings(input.mode, missingRequiredArtifacts, truncated),
      storyStateMutated: false
    },
    DiagnosticsContextManifestSchema
  );
  await fileStore.writeText(versioned.mdPath, renderManifestMarkdown(manifest));
  const afterState = await readOptionalText(paths.storyState(), fileStore);
  if (afterState !== beforeState) {
    throw new Error('diagnostics context manifest mutated Story State');
  }
  return {
    manifest,
    manifestPath: versioned.relativeJsonPath,
    markdownPath: versioned.relativeMdPath,
    promptContext: finalPromptContext
  };
}

async function buildCandidates(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  storyState: StoryState,
  selectedDraftPath?: string
): Promise<ContextArtifactCandidate[]> {
  const missionPath = relativeChapterArtifact(chapterNumber, 'mission.json');
  const selectedPlanPath = relativeChapterArtifact(chapterNumber, 'selected_plan.md');
  const draftPath = selectedDraftPath ?? relativeChapterArtifact(chapterNumber, 'draft_v1.md');
  const mission = await readOptionalJson(paths.projectArtifact(missionPath), fileStore);
  const selectedPlan = await readOptionalText(paths.projectArtifact(selectedPlanPath), fileStore);
  const draft = await readOptionalText(paths.projectArtifact(draftPath), fileStore);
  return [
    {
      name: 'story_state summary',
      path: path.join('state', 'story_state.json'),
      artifactType: 'story_state_summary',
      text: JSON.stringify(summarizeStoryState(storyState), null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'canonical state summary for diagnostics evidence'
    },
    {
      name: 'character_states',
      path: path.join('state', 'story_state.json#characters'),
      artifactType: 'character_states',
      text: JSON.stringify(storyState.characters, null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'character knowledge and status continuity'
    },
    {
      name: 'timeline',
      path: path.join('state', 'story_state.json#timeline'),
      artifactType: 'timeline',
      text: JSON.stringify(storyState.timeline, null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'canonical event ordering and timestamps'
    },
    {
      name: 'reader_state',
      path: path.join('state', 'story_state.json#readerState'),
      artifactType: 'reader_state',
      text: JSON.stringify(storyState.readerState, null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'reader knowledge, suspects, and expectations'
    },
    {
      name: 'open narrative debts',
      path: path.join('state', 'story_state.json#narrativeDebts'),
      artifactType: 'narrative_debts',
      text: JSON.stringify(storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved'), null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'open obligations that diagnostics must preserve'
    },
    {
      name: 'unresolved foreshadowing',
      path: path.join('state', 'story_state.json#foreshadowing'),
      artifactType: 'foreshadowing',
      text: JSON.stringify(storyState.foreshadowing.filter((item) => item.status !== 'resolved'), null, 2),
      present: true,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'unresolved signals that must not be treated as accidental reveals'
    },
    {
      name: 'selected plan',
      path: selectedPlanPath,
      artifactType: 'selected_plan',
      text: selectedPlan,
      present: selectedPlan.trim().length > 0,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'approved planning intent for the chapter'
    },
    {
      name: 'chapter mission',
      path: missionPath,
      artifactType: 'chapter_mission',
      text: mission === undefined ? '' : JSON.stringify(mission, null, 2),
      present: mission !== undefined,
      includeInBaseline: false,
      includeInEnhanced: true,
      reason: 'chapter-specific objectives and forbidden moves'
    },
    {
      name: 'chapter draft',
      path: draftPath,
      artifactType: 'draft',
      text: draft,
      present: draft.trim().length > 0,
      includeInBaseline: true,
      includeInEnhanced: true,
      reason: 'canonical draft under diagnostics'
    }
  ];
}

function renderPromptContext(mode: DiagnosticsContextMode, artifacts: ContextArtifactCandidate[], budgetBytes: number): string {
  const lines = [
    `DIAGNOSTICS_CONTEXT_MODE: ${mode}`,
    '',
    'Diagnostics Evidence Rules:',
    '- Keep hard checks strict; do not lower or ignore continuity gates.',
    '- Mark a hard check failed only when the draft contradicts supplied evidence.',
    '- If evidence is missing, say insufficient evidence instead of inventing a contradiction.',
    '- Distinguish confirmed contradiction, missing evidence, and possible risk.',
    `- Context budget bytes: ${budgetBytes}`,
    ''
  ];
  for (const artifact of artifacts) {
    lines.push(`## ${artifact.name}`);
    lines.push(`path: ${artifact.path}`);
    lines.push(artifact.text.trim().length === 0 ? '(empty)' : artifact.text.trim());
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderManifestMarkdown(manifest: DiagnosticsContextManifest): string {
  return [
    '# Diagnostics Context Manifest',
    '',
    `projectId: ${manifest.projectId}`,
    `chapterNumber: ${manifest.chapterNumber}`,
    `mode: ${manifest.mode}`,
    `contextBytes: ${manifest.contextBytes}`,
    `contextTruncated: ${String(manifest.contextTruncated)}`,
    `missingRequiredArtifacts: ${manifest.missingRequiredArtifacts.join(', ') || 'none'}`,
    '',
    'Included:',
    ...manifest.includedArtifacts.map((artifact) => `- ${artifact.name}: ${artifact.path}`)
  ].join('\n') + '\n';
}

function summarizeStoryState(storyState: StoryState) {
  return {
    latestCommittedChapter: storyState.latestCommittedChapter,
    canonFacts: storyState.canonFacts.slice(-8).map((fact) => ({ id: fact.id, text: fact.text, sourceChapter: fact.sourceChapter })),
    timeline: storyState.timeline.slice(-8),
    readerState: storyState.readerState,
    openNarrativeDebts: storyState.narrativeDebts.filter((debt) => debt.status !== 'resolved'),
    unresolvedForeshadowing: storyState.foreshadowing.filter((item) => item.status !== 'resolved')
  };
}

function shouldInclude(mode: DiagnosticsContextMode, candidate: ContextArtifactCandidate): boolean {
  return mode === 'baseline' ? candidate.includeInBaseline : candidate.includeInEnhanced;
}

function toManifestArtifact(candidate: ContextArtifactCandidate, included: boolean) {
  return {
    name: candidate.name,
    path: candidate.path,
    artifactType: candidate.artifactType,
    bytes: byteLength(candidate.text),
    included,
    reason: candidate.reason
  };
}

function buildWarnings(mode: DiagnosticsContextMode, missing: string[], truncated: boolean): string[] {
  const warnings: string[] = [];
  if (mode === 'enhanced' && missing.length > 0) warnings.push(`Enhanced diagnostics context is missing required artifacts: ${missing.join(', ')}.`);
  if (truncated) warnings.push('Diagnostics context was truncated to fit the byte budget.');
  return warnings;
}

async function readOptionalJson(absolutePath: string, fileStore: FileStore): Promise<ChapterMission | undefined> {
  if (!(await fileStore.exists(absolutePath))) return undefined;
  return fileStore.readJson(absolutePath, ChapterMissionSchema);
}

async function readOptionalText(absolutePath: string, fileStore: FileStore): Promise<string> {
  if (!(await fileStore.exists(absolutePath))) return '';
  return fileStore.readText(absolutePath);
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.chapterArtifact(chapterNumber, jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.chapterArtifact(chapterNumber, mdFile),
        relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonFile),
        relativeMdPath: relativeChapterArtifact(chapterNumber, mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}
