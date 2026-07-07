import path from 'node:path';

import { FinalAssemblyReportSchema, SceneCardsSchema } from '../schemas/index.js';
import type { FinalAssemblyReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface AssembleFinalLocallyInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  mode?: 'local-assemble' | 'light-polish';
}

export interface AssembleFinalLocallyResult {
  artifact: string;
  reportPath: string;
  markdownPath: string;
  report: FinalAssemblyReport;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function assembleFinalLocally(input: AssembleFinalLocallyInput, fileStore = new FileStore()): Promise<AssembleFinalLocallyResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const mode = input.mode ?? 'local-assemble';
  const chapterNumber = input.chapterNumber;
  const sceneCards = await fileStore.readJson(paths.chapterArtifact(chapterNumber, 'scene_cards.json'), SceneCardsSchema);
  const selectedPlanPath = relativeChapterArtifact(chapterNumber, 'selected_plan.md');
  const sceneCardsPath = relativeChapterArtifact(chapterNumber, 'scene_cards.json');
  await fileStore.readText(paths.chapterArtifact(chapterNumber, 'selected_plan.md'));
  const warnings: string[] = [];
  if (mode === 'light-polish') {
    warnings.push('light-polish scaffold used local assembly only in M27.5; no Codex polish call was made.');
  }
  const sourceScenePaths: string[] = [];
  const sceneDrafts: string[] = [];
  for (const sceneCard of [...sceneCards].sort((left, right) => left.order - right.order || left.sceneId.localeCompare(right.sceneId))) {
    const scenePath = relativeChapterArtifact(chapterNumber, 'scenes', `${sceneCard.sceneId}.md`);
    sourceScenePaths.push(scenePath);
    const rawScene = await fileStore.readText(paths.projectArtifact(scenePath));
    sceneDrafts.push(stripDuplicateHeading(rawScene).trim());
  }
  const outputFinalPath = relativeChapterArtifact(chapterNumber, 'final.md');
  const finalText = [`# Chapter ${formatChapterNumber(chapterNumber)}`, ...sceneDrafts.filter((scene) => scene.length > 0)].join('\n\n').trim() + '\n';
  await fileStore.writeText(paths.projectArtifact(outputFinalPath), finalText);
  const artifact = await nextVersionedChapterArtifact(paths, fileStore, chapterNumber, 'final_assembly_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `final_assembly_ch${formatChapterNumber(chapterNumber)}_v${artifact.version}`,
      projectId: paths.projectId,
      chapterNumber,
      mode,
      sourceScenePaths,
      selectedPlanPath,
      sceneCardsPath,
      outputFinalPath,
      sceneCount: sourceScenePaths.length,
      wordCount: wordCount(finalText),
      warnings,
      generatedAt: new Date().toISOString()
    },
    FinalAssemblyReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderFinalAssemblyMarkdown(report));
  return {
    artifact: outputFinalPath,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath,
    report
  };
}

function stripDuplicateHeading(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line, index) => !(index === 0 && /^#{1,2}\s+chapter\s+\d+/i.test(line.trim())))
    .join('\n');
}

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.posix.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, ...segments);
}

async function nextVersionedChapterArtifact(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonPath = paths.chapterArtifact(chapterNumber, jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.chapterArtifact(chapterNumber, mdFile),
        relativeJsonPath: relativeChapterArtifact(chapterNumber, jsonFile),
        relativeMdPath: relativeChapterArtifact(chapterNumber, mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} for chapter ${chapterNumber}.`);
}

function renderFinalAssemblyMarkdown(report: FinalAssemblyReport): string {
  return [
    `# Final Assembly ${report.reportId}`,
    '',
    `mode: ${report.mode}`,
    `chapterNumber: ${report.chapterNumber}`,
    `sceneCount: ${report.sceneCount}`,
    `wordCount: ${report.wordCount}`,
    `outputFinalPath: ${report.outputFinalPath}`,
    '',
    '## Source Scenes',
    ...report.sourceScenePaths.map((scenePath) => `- ${scenePath}`),
    '',
    '## Warnings',
    ...(report.warnings.length === 0 ? ['none'] : report.warnings.map((warning) => `- ${warning}`))
  ].join('\n') + '\n';
}
