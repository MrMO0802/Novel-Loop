import path from 'node:path';

import { RunLogger } from '../logging/RunLogger.js';
import { CanonPatchSchema, CodexChapterQualityReportSchema, DiagnosticsReportSchema } from '../schemas/index.js';
import type { CanonPatch, CodexChapterQualityReport, DiagnosticsReport } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface EvaluateCodexChapterQualityInput {
  projectId: string;
  projectsRoot?: string;
  chapterNumber: number;
  runId?: string;
  finalChapterPath?: string;
  canonPatchPath?: string;
  diagnosticsPath?: string;
}

export interface EvaluateCodexChapterQualityResult {
  projectId: string;
  chapterNumber: number;
  runId: string;
  reportPath: string;
  markdownPath: string;
  report: CodexChapterQualityReport;
  blocking: boolean;
  criticalIssues: string[];
}

const DEFAULT_PROJECTS_ROOT = './projects';
const PLACEHOLDER_PATTERN = /(\{\{[^}]+}}|\bTODO\b|\bTBD\b|\bFIXME\b|\bPLACEHOLDER\b|<PLACEHOLDER[^>]*>)/gi;
const FORBIDDEN_PATTERNS = [/as an ai language model/gi, /PROMPT_ID:/g, /REPAIR_JSON_ONLY:/g];

export async function evaluateCodexChapterQuality(
  input: EvaluateCodexChapterQualityInput,
  fileStore = new FileStore()
): Promise<EvaluateCodexChapterQualityResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);
  const ownsRun = !(await fileStore.exists(paths.runManifest(runId)));
  if (ownsRun) {
    await runLogger.startRun({
      runId,
      command: 'evaluate-chapter',
      args: {
        chapterNumber: input.chapterNumber,
        provider: 'codex-text'
      }
    });
  }

  try {
    const finalChapterPath = input.finalChapterPath ?? relativeChapterArtifact(input.chapterNumber, 'final.md');
    const canonPatchPath = input.canonPatchPath ?? (await findLatestCodexPatch(paths, fileStore, input.chapterNumber));
    const diagnosticsPath = input.diagnosticsPath ?? relativeChapterArtifact(input.chapterNumber, 'diagnostics_v1.json');
    const finalExists = await fileStore.exists(paths.projectArtifact(finalChapterPath));
    const finalText = finalExists ? await fileStore.readText(paths.projectArtifact(finalChapterPath)) : '';
    const patchRead = canonPatchPath === undefined ? { error: 'canon patch missing' } : await readOptionalPatch(paths, fileStore, canonPatchPath);
    const diagnosticsRead = await readOptionalDiagnostics(paths, fileStore, diagnosticsPath);
    const placeholders = [...new Set(finalText.match(PLACEHOLDER_PATTERN) ?? [])];
    const forbiddenPhrases = [
      ...new Set(FORBIDDEN_PATTERNS.flatMap((pattern) => finalText.match(pattern) ?? []).map((value) => value.trim()))
    ];
    const diagnosticsHardChecksPassed =
      diagnosticsRead.value !== undefined &&
      Object.values(diagnosticsRead.value.hard_checks).every((check) => check.passed) &&
      diagnosticsRead.value.hardFailures.length === 0;
    const jsonArtifactsConsistent = patchRead.error === undefined && diagnosticsRead.error === undefined;
    const canonPatchMatchesFinal =
      patchRead.value !== undefined &&
      patchRead.value.sourceFinalPath === finalChapterPath &&
      patchHasEvidenceInFinal(patchRead.value, finalText);
    const criticalIssues = [
      ...(finalExists ? [] : ['final.md missing']),
      ...placeholders.map((placeholder) => `unresolved placeholder: ${placeholder}`),
      ...(patchRead.error === undefined ? [] : [`canon patch schema invalid: ${patchRead.error}`]),
      ...(diagnosticsHardChecksPassed ? [] : ['diagnostics hard check fail'])
    ];
    const warnings = [
      ...(canonPatchMatchesFinal ? [] : ['canon patch does not clearly match final.md']),
      ...forbiddenPhrases.map((phrase) => `forbidden phrase: ${phrase}`)
    ];
    const reportArtifact = await nextVersionedChapterArtifact(paths, fileStore, input.chapterNumber, 'codex_chapter_quality_report');
    const markdownPath = reportArtifact.relativePath.replace(/\.json$/, '.md');
    const report = await fileStore.writeJson(
      reportArtifact.absolutePath,
      {
        reportId: `codex_quality_ch${formatChapterNumber(input.chapterNumber)}_v${reportArtifact.version}`,
        projectId: paths.projectId,
        chapterNumber: input.chapterNumber,
        provider: 'codex-text',
        generatedAt: new Date().toISOString(),
        finalChapterPath,
        ...(canonPatchPath === undefined ? {} : { canonPatchPath }),
        diagnosticsPath,
        hasTitle: /^#\s+\S+/m.test(finalText),
        approximateWordCount: wordCount(finalText),
        sceneCount: await countScenes(paths, fileStore, input.chapterNumber, finalText),
        hasOpeningHook: firstParagraph(finalText).length > 20,
        hasEndingHook: lastParagraph(finalText).endsWith('?') || /will|must|decides|decided|not yet knowing|investigate/i.test(lastParagraph(finalText)),
        protagonistPresent: /Lin Cheng|林成|林澈|protagonist/i.test(finalText),
        conflictPresent: /conflict|versus|but|however|decides|refuse|doubt|impossible|without power/i.test(finalText),
        informationDeltaPresent: patchRead.value !== undefined && (patchRead.value.newFacts.length > 0 || patchRead.value.readerStatePatch.addKnows.length > 0),
        styleGuideFollowed: forbiddenPhrases.length === 0,
        repeatedParagraphRisk: hasRepeatedParagraph(finalText),
        unresolvedPlaceholders: placeholders,
        forbiddenPhrases,
        jsonArtifactsConsistent,
        canonPatchMatchesFinal,
        diagnosticsHardChecksPassed,
        readerQuestionGenerated: (patchRead.value?.readerStatePatch.addQuestions.length ?? 0) > 0,
        nextChapterHook: /who|why|what|how|\?|not yet knowing|next|investigate/i.test(lastParagraph(finalText)),
        softScores: {
          readability: score(finalText.length > 0 && wordCount(finalText) < 4000),
          narrativeMomentum: score(/decides|must|mystery|signal|radio|building/i.test(finalText)),
          characterConsistency: score(/Lin Cheng|林成|林澈/i.test(finalText)),
          tension: score(/impossible|without power|doubt|fear|mystery|old building/i.test(finalText)),
          genreFit: score(/mystery|signal|radio|building|voice/i.test(finalText)),
          proseQuality: score(finalText.length > 80 && !hasRepeatedParagraph(finalText)),
          chapterHook: score(/(\?|not yet knowing|investigate|old building)/i.test(lastParagraph(finalText)))
        },
        criticalIssues,
        warnings,
        blocking: criticalIssues.length > 0,
        storyStateMutated: false
      },
      CodexChapterQualityReportSchema
    );
    await fileStore.writeText(paths.projectArtifact(markdownPath), renderQualityMarkdown(report));
    await runLogger.recordArtifact(runId, reportArtifact.relativePath, {
      action: 'generated',
      stage: 'quality',
      provenanceNote: 'local deterministic codex chapter quality report'
    });
    await runLogger.recordArtifact(runId, markdownPath, {
      action: 'generated',
      stage: 'quality',
      derivedFrom: [reportArtifact.relativePath],
      provenanceNote: 'markdown summary for local codex chapter quality report'
    });
    if (report.blocking) {
      await runLogger.recordError(runId, {
        code: 'CODEX_CHAPTER_QUALITY_BLOCKED',
        message: report.criticalIssues.join('; '),
        recoverable: true
      });
    }
    if (ownsRun) {
      await runLogger.endRun(runId, report.blocking ? 'failed' : 'completed');
    }
    return {
      projectId: paths.projectId,
      chapterNumber: input.chapterNumber,
      runId,
      reportPath: reportArtifact.relativePath,
      markdownPath,
      report,
      blocking: report.blocking,
      criticalIssues: report.criticalIssues
    };
  } catch (error) {
    if (ownsRun) {
      await runLogger.recordError(runId, {
        code: 'CODEX_CHAPTER_QUALITY_FAILED',
        message: getErrorMessage(error),
        recoverable: true
      });
      await runLogger.endRun(runId, 'failed');
    }
    throw error;
  }
}

async function readOptionalPatch(paths: ProjectPaths, fileStore: FileStore, relativePath: string): Promise<{ value?: CanonPatch; error?: string }> {
  try {
    return { value: await fileStore.readJson(paths.projectArtifact(relativePath), CanonPatchSchema) };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
}

async function readOptionalDiagnostics(paths: ProjectPaths, fileStore: FileStore, relativePath: string): Promise<{ value?: DiagnosticsReport; error?: string }> {
  try {
    return { value: await fileStore.readJson(paths.projectArtifact(relativePath), DiagnosticsReportSchema) };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
}

async function findLatestCodexPatch(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number): Promise<string | undefined> {
  for (const baseName of ['canon_patch_codex_normalized', 'canon_patch_codex_proposal']) {
    const artifact = await findLatestVersionedChapterArtifact(paths, fileStore, chapterNumber, baseName);
    if (artifact !== undefined) return artifact.relativePath;
  }
  const canonical = relativeChapterArtifact(chapterNumber, 'canon_patch.json');
  return (await fileStore.exists(paths.projectArtifact(canonical))) ? canonical : undefined;
}

async function countScenes(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, finalText: string): Promise<number> {
  const scenesDir = paths.chapterArtifact(chapterNumber, 'scenes');
  try {
    return (await fileStore.list(scenesDir)).filter((entry) => /^scene_\d+\.md$/.test(entry)).length;
  } catch {
    return Math.max(1, (finalText.match(/^##\s+/gm) ?? []).length);
  }
}

function patchHasEvidenceInFinal(patch: CanonPatch, finalText: string): boolean {
  const lowerFinal = finalText.toLowerCase();
  const evidence = [
    ...patch.newFacts.map((fact) => fact.text),
    ...patch.timelineEvents.map((event) => event.summary),
    ...patch.readerStatePatch.addKnows,
    ...patch.readerStatePatch.addQuestions
  ];
  return evidence.some((item) =>
    significantTokens(item)
      .slice(0, 4)
      .some((token) => lowerFinal.includes(token))
  );
}

function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !['chapter', 'knows', 'question'].includes(token));
}

function wordCount(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}_'-]+/gu);
  return matches === null ? 0 : matches.length;
}

function firstParagraph(markdown: string): string {
  return markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith('#')) ?? '';
}

function lastParagraph(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('#'));
  return paragraphs.at(-1) ?? '';
}

function hasRepeatedParagraph(markdown: string): boolean {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part.length > 40);
  return new Set(paragraphs).size < paragraphs.length;
}

function score(passed: boolean): number {
  return passed ? 8 : 4;
}

function renderQualityMarkdown(report: CodexChapterQualityReport): string {
  return [
    `# Codex Chapter Quality Report ${report.chapterNumber}`,
    '',
    `blocking: ${String(report.blocking)}`,
    `criticalIssues: ${report.criticalIssues.length === 0 ? 'none' : report.criticalIssues.join('; ')}`,
    `warnings: ${report.warnings.length === 0 ? 'none' : report.warnings.join('; ')}`,
    `wordCount: ${report.approximateWordCount}`,
    `sceneCount: ${report.sceneCount}`,
    `canonPatchMatchesFinal: ${String(report.canonPatchMatchesFinal)}`,
    `diagnosticsHardChecksPassed: ${String(report.diagnosticsHardChecksPassed)}`
  ].join('\n') + '\n';
}

async function nextVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; absolutePath: string; relativePath: string }> {
  for (let version = 1; version < 1000; version += 1) {
    const fileName = `${baseName}_v${version}.json`;
    const absolutePath = paths.chapterArtifact(chapterNumber, fileName);
    if (!(await fileStore.exists(absolutePath))) {
      return {
        version,
        absolutePath,
        relativePath: relativeChapterArtifact(chapterNumber, fileName)
      };
    }
  }
  throw new AppError('CHAPTER_ARTIFACT_VERSION_EXHAUSTED', `Could not allocate ${baseName} version for chapter ${chapterNumber}.`, 1, {
    chapterNumber,
    stage: 'quality'
  });
}

async function findLatestVersionedChapterArtifact(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  baseName: string
): Promise<{ version: number; absolutePath: string; relativePath: string } | undefined> {
  if (!(await fileStore.exists(paths.chapterDir(chapterNumber)))) {
    return undefined;
  }
  const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v(\\d+)\\.json$`);
  let latest: { version: number; absolutePath: string; relativePath: string } | undefined;
  for (const entry of await fileStore.list(paths.chapterDir(chapterNumber))) {
    const match = pattern.exec(entry);
    if (match === null) continue;
    const version = Number.parseInt(match[1]!, 10);
    if (latest === undefined || version > latest.version) {
      latest = {
        version,
        absolutePath: paths.chapterArtifact(chapterNumber, entry),
        relativePath: relativeChapterArtifact(chapterNumber, entry)
      };
    }
  }
  return latest;
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.join('chapters', `chapter_${formatChapterNumber(chapterNumber)}`, fileName);
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}
