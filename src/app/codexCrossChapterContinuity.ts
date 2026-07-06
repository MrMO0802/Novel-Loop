import path from 'node:path';

import {
  ChapterContextSummarySchema,
  ChapterQueueSchema,
  CodexCrossChapterContinuityReportSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type {
  ChapterContextSummary,
  CodexCrossChapterContinuityReport,
  CodexCrossChapterDriftIssue,
  CodexCrossChapterLink,
  StoryState
} from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface EvaluateCodexCrossChapterContinuityInput {
  projectId: string;
  projectsRoot?: string;
  chapters: number[];
}

export interface EvaluateCodexCrossChapterContinuityResult {
  report: CodexCrossChapterContinuityReport;
  reportPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function evaluateCodexCrossChapterContinuity(
  input: EvaluateCodexCrossChapterContinuityInput,
  fileStore = new FileStore()
): Promise<EvaluateCodexCrossChapterContinuityResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  await fileStore.ensureDir(paths.auditDir());
  const storyState = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  const blockingIssues: CodexCrossChapterDriftIssue[] = [];
  const warnings: CodexCrossChapterDriftIssue[] = [];
  const summaries = new Map<number, ChapterContextSummary>();
  const summariesMissing: number[] = [];

  for (const chapterNumber of input.chapters) {
    const queueItem = queue.chapters.find((chapter) => chapter.chapterNumber === chapterNumber);
    if (queueItem?.status !== 'committed' && queueItem?.status !== 'recommitted') {
      blockingIssues.push(issue(`queue_ch${chapterNumber}_not_committed`, chapterNumber, 'critical', `Chapter ${chapterNumber} queue status is ${queueItem?.status ?? 'missing'}.`, 'planning/chapter_queue.json'));
    }
    if (!(await fileStore.exists(paths.chapterArtifact(chapterNumber, 'final.md')))) {
      blockingIssues.push(issue(`final_ch${chapterNumber}_missing`, chapterNumber, 'critical', `Chapter ${chapterNumber} final.md is missing.`, relativeChapterArtifact(chapterNumber, 'final.md')));
    }
    const summaryPath = paths.chapterArtifact(chapterNumber, 'chapter_summary_for_context.json');
    if (await fileStore.exists(summaryPath)) {
      try {
        summaries.set(chapterNumber, await fileStore.readJson(summaryPath, ChapterContextSummarySchema));
      } catch {
        warnings.push(issue(`summary_ch${chapterNumber}_invalid`, chapterNumber, 'warning', `Chapter ${chapterNumber} context summary is invalid.`, relativeChapterArtifact(chapterNumber, 'chapter_summary_for_context.json')));
      }
    } else {
      summariesMissing.push(chapterNumber);
      warnings.push(issue(`summary_ch${chapterNumber}_missing`, chapterNumber, 'warning', `Chapter ${chapterNumber} context summary is missing; prompt context may fall back to larger artifacts.`, relativeChapterArtifact(chapterNumber, 'chapter_summary_for_context.json')));
    }
    await checkPlaceholders(paths, fileStore, chapterNumber, blockingIssues);
  }

  const chapterLinks: CodexCrossChapterLink[] = [];
  for (let index = 1; index < input.chapters.length; index += 1) {
    const fromChapter = input.chapters[index - 1]!;
    const toChapter = input.chapters[index]!;
    chapterLinks.push(buildLink(storyState, summaries, fromChapter, toChapter));
  }

  const duplicateHookRisk = duplicateHooks([...summaries.values()]);
  const repeatedScenePatternRisk = await repeatedScenePattern(paths, fileStore, input.chapters);
  if (duplicateHookRisk) {
    warnings.push(issue('duplicate_hook_risk', undefined, 'warning', 'Adjacent chapter summaries repeat similar next-chapter hooks.', 'chapters'));
  }
  if (repeatedScenePatternRisk) {
    warnings.push(issue('repeated_scene_pattern_risk', undefined, 'warning', 'Multiple chapters use the same scene count and may need pattern review.', 'chapters'));
  }

  const continuityScore = Math.max(
    0,
    Math.min(10, 10 - blockingIssues.length * 3 - warnings.length * 0.5 + chapterLinks.filter((link) => link.strength === 'strong').length)
  );
  const recommendations = [
    'Prefer chapter_summary_for_context.json over full previous chapters in future Codex prompts.',
    'Review weak chapterLinks before continuing beyond the benchmark range.',
    ...(summariesMissing.length > 0 ? ['Generate missing chapter summaries before rich-context Codex runs.'] : [])
  ];
  const artifact = await nextAuditArtifact(paths, fileStore, 'codex_cross_chapter_continuity_report');
  const report = await fileStore.writeJson(
    artifact.jsonPath,
    {
      reportId: `codex_cross_chapter_continuity_report_v${artifact.version}`,
      projectId: paths.projectId,
      generatedAt: new Date().toISOString(),
      chapters: input.chapters,
      continuityScore,
      blockingIssues,
      warnings,
      recommendations,
      chapterLinks,
      summariesMissing,
      duplicateHookRisk,
      repeatedScenePatternRisk,
      storyStateMutated: false
    },
    CodexCrossChapterContinuityReportSchema
  );
  await fileStore.writeText(artifact.mdPath, renderContinuityMarkdown(report));
  return {
    report,
    reportPath: artifact.relativeJsonPath,
    markdownPath: artifact.relativeMdPath
  };
}

function buildLink(
  storyState: StoryState,
  summaries: Map<number, ChapterContextSummary>,
  fromChapter: number,
  toChapter: number
): CodexCrossChapterLink {
  const fromFacts = storyState.canonFacts.filter((fact) => fact.sourceChapter === fromChapter).map((fact) => fact.id);
  const toFacts = storyState.canonFacts.filter((fact) => fact.sourceChapter === toChapter).map((fact) => fact.id);
  const linkedDebtIds = storyState.narrativeDebts
    .filter((debt) => debt.introducedInChapter === fromChapter || debt.payoffHistory.some((history) => history.chapter === toChapter))
    .map((debt) => debt.id);
  const linkedForeshadowingIds = storyState.foreshadowing
    .filter((item) => item.introducedInChapter === fromChapter || item.payoffTargetChapter === toChapter)
    .map((item) => item.id);
  const linkedReaderExpectations = storyState.readerState.readerExpectations.slice(0, 4);
  const fromSummary = summaries.get(fromChapter);
  const toSummary = summaries.get(toChapter);
  const evidence = [
    ...(fromSummary === undefined ? [] : [`from summary: ${fromSummary.shortSummary}`]),
    ...(toSummary === undefined ? [] : [`to summary: ${toSummary.shortSummary}`])
  ].map((item) => summarize(item, 260));
  const linkWeight = fromFacts.length + toFacts.length + linkedDebtIds.length + linkedForeshadowingIds.length + linkedReaderExpectations.length;
  return {
    fromChapter,
    toChapter,
    linkedFactIds: [...fromFacts.slice(0, 4), ...toFacts.slice(0, 4)],
    linkedDebtIds: linkedDebtIds.slice(0, 6),
    linkedForeshadowingIds: linkedForeshadowingIds.slice(0, 6),
    linkedReaderExpectations,
    evidence,
    strength: linkWeight >= 6 ? 'strong' : linkWeight >= 2 ? 'medium' : 'weak'
  };
}

async function checkPlaceholders(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  blockingIssues: CodexCrossChapterDriftIssue[]
): Promise<void> {
  const finalPath = paths.chapterArtifact(chapterNumber, 'final.md');
  if (!(await fileStore.exists(finalPath))) return;
  const final = await fileStore.readText(finalPath);
  if (/(\{\{[^}]+}}|\bTODO\b|\bTBD\b|\bFIXME\b|\bPLACEHOLDER\b)/i.test(final)) {
    blockingIssues.push(issue(`placeholder_ch${chapterNumber}`, chapterNumber, 'critical', `Chapter ${chapterNumber} final.md contains unresolved placeholder text.`, relativeChapterArtifact(chapterNumber, 'final.md')));
  }
}

function duplicateHooks(summaries: ChapterContextSummary[]): boolean {
  const hooks = summaries.flatMap((summary) => summary.nextChapterHooks.map((hook) => normalize(hook))).filter((hook) => hook.length > 12);
  return new Set(hooks).size < hooks.length;
}

async function repeatedScenePattern(paths: ProjectPaths, fileStore: FileStore, chapters: number[]): Promise<boolean> {
  const counts: number[] = [];
  for (const chapterNumber of chapters) {
    const scenesDir = paths.chapterArtifact(chapterNumber, 'scenes');
    if (!(await fileStore.exists(scenesDir))) continue;
    counts.push((await fileStore.list(scenesDir)).filter((entry) => /^scene_\d+\.md$/.test(entry)).length);
  }
  return counts.length >= 3 && new Set(counts).size === 1;
}

function issue(
  issueId: string,
  chapterNumber: number | undefined,
  severity: 'warning' | 'error' | 'critical',
  message: string,
  pathValue: string
): CodexCrossChapterDriftIssue {
  return {
    issueId,
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
    severity,
    message,
    path: pathValue
  };
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.join('audit', jsonFile),
        relativeMdPath: path.join('audit', mdFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName} audit artifact.`);
}

function renderContinuityMarkdown(report: CodexCrossChapterContinuityReport): string {
  return [
    `# Codex Cross-Chapter Continuity ${report.projectId}`,
    '',
    `continuityScore: ${report.continuityScore}`,
    `blockingIssues: ${report.blockingIssues.length}`,
    `warnings: ${report.warnings.length}`,
    '',
    '## Chapter Links',
    ...(report.chapterLinks.length === 0
      ? ['- none']
      : report.chapterLinks.map((link) => `- ${link.fromChapter} -> ${link.toChapter}: ${link.strength}`)),
    '',
    '## Recommendations',
    ...report.recommendations.map((recommendation) => `- ${recommendation}`)
  ].join('\n') + '\n';
}

function summarize(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function relativeChapterArtifact(chapterNumber: number, ...segments: string[]): string {
  return path.join('chapters', `chapter_${String(chapterNumber).padStart(3, '0')}`, ...segments);
}
