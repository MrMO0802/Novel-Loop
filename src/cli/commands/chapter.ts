import type { Command } from 'commander';

import { ChapterQueueStore } from '../../app/chapterQueue.js';
import { runChapterUntilDraft } from '../../app/chapterDrafting.js';
import { runChapterFullProduction, runChapterResume } from '../../app/chapterPipeline.js';
import { runChapterDryRun } from '../../app/chapterPlanning.js';
import type { FailureInjectionPoint } from '../../app/pipelineFailure.js';
import type { ProviderName } from '../../llm/ProviderFactory.js';
import { ChapterQueueStageSchema, ReusePolicySchema, StoryStateSchema } from '../../schemas/index.js';
import type { ChapterQueueStage, ReusePolicy } from '../../schemas/index.js';
import { FileStore } from '../../storage/FileStore.js';
import { ProjectPaths } from '../../storage/ProjectPaths.js';
import { AppError } from '../../utils/AppError.js';
import { addCodexOptions, resolveCodexCliOptionsIfNeeded } from '../codexOptions.js';
import { PROJECTS_ROOT_OPTION_HELP, PROVIDER_OPTION_HELP } from '../help.js';

interface ChapterCommandOptions {
  provider?: ProviderName;
  root?: string;
  codexBin?: string;
  codexProfile?: string;
  codexJsonRetries?: string;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: string;
  dryRun?: boolean;
  candidates?: string;
  until?: string;
  maxRevisions?: string;
  commit?: boolean;
  confirmCodexCommit?: boolean;
  rerunCodexOnConfirm?: boolean;
  resume?: boolean;
  forceStage?: string;
  failAt?: string;
  mockScenario?: string;
  repairConflicts?: boolean;
  maxConflictRepairs?: string;
  regenerateStale?: boolean;
  reusePolicy?: string;
}

export function registerChapterCommand(program: Command): void {
  addCodexOptions(
    program
    .command('chapter')
    .description('Run chapter planning, drafting, revision, and optional commit')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<chapterNumber>', 'chapter number or next')
    .option('--provider <provider>', PROVIDER_OPTION_HELP, 'mock')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
  )
    .option('--dry-run', 'generate planning artifacts without prose or state commit', false)
    .option('--candidates <count>', 'number of plan candidates', '3')
    .option('--until <stage>', 'run chapter steps until stage: draft')
    .option('--max-revisions <count>', 'maximum revision attempts before human review')
    .option('--commit', 'commit final chapter canon patch into Story State', false)
    .option('--confirm-codex-commit', 'confirm codex-text controlled commit after preview', false)
    .option('--rerun-codex-on-confirm', 'rerun Codex during confirmed codex-text commit instead of reusing preview artifacts', false)
    .option('--resume', 'resume the first failed or in-progress chapter from chapter_queue.json', false)
    .option('--force-stage <stage>', 'regenerate one non-committed stage explicitly')
    .option('--fail-at <point>', 'test hook: inject a failure at a pipeline point')
    .option('--mock-scenario <scenario>', 'mock provider scenario for deterministic test/demo fixtures')
    .option('--repair-conflicts', 'attempt canon patch conflict repair before commit', false)
    .option('--max-conflict-repairs <count>', 'maximum automatic canon patch repair attempts', '2')
    .option('--regenerate-stale', 'regenerate the earliest stale chapter instead of creating a new next chapter', false)
    .option('--reuse-policy <policy>', 'stale regeneration reuse policy: preserve_nothing, reference_only, preserve_scene_structure_if_valid, preserve_final_text_if_unaffected', 'reference_only')
    .action(async (projectId: string, chapterNumberText: string, options: ChapterCommandOptions) => {
      const projectsRoot = options.root ?? './projects';
      const candidates = parsePositiveInteger(options.candidates ?? '3', 'candidates');
      const maxRevisions =
        options.maxRevisions === undefined ? undefined : parseNonNegativeInteger(options.maxRevisions, 'maxRevisions');
      const forceStage = options.forceStage === undefined ? undefined : parseForceStage(options.forceStage);
      const failAt = options.failAt === undefined ? undefined : parseFailurePoint(options.failAt);
      const maxConflictRepairs = parseNonNegativeInteger(options.maxConflictRepairs ?? '2', 'maxConflictRepairs');
      const reusePolicy = parseReusePolicy(options.reusePolicy ?? 'reference_only');
      const codexOptions = resolveCodexCliOptionsIfNeeded(options);

      if (options.dryRun && (options.until !== undefined || maxRevisions !== undefined || options.commit === true)) {
        throw new AppError('CHAPTER_OPTION_CONFLICT', 'Use --dry-run, --until, or --max-revisions/--commit as separate chapter modes.', 2);
      }

      if (options.until !== undefined && (maxRevisions !== undefined || options.commit === true)) {
        throw new AppError('CHAPTER_OPTION_CONFLICT', 'Use --until or --max-revisions/--commit as separate chapter modes.', 2);
      }

      if (options.resume === true && (options.dryRun || options.until !== undefined)) {
        throw new AppError('CHAPTER_OPTION_CONFLICT', 'Use --resume with the full chapter pipeline, not --dry-run or --until.', 2);
      }

      if (options.regenerateStale === true && (options.dryRun || options.until !== undefined || options.resume === true)) {
        throw new AppError('CHAPTER_OPTION_CONFLICT', 'Use --regenerate-stale with the full chapter pipeline.', 2);
      }

      if (options.resume === true) {
        const result = await runChapterResume({
          projectId,
          projectsRoot,
          provider: options.provider ?? 'mock',
          ...codexOptions,
          candidates,
          ...(maxRevisions === undefined ? {} : { maxRevisions }),
          commit: options.commit === true,
          confirmCodexCommit: options.confirmCodexCommit === true,
          rerunCodexOnConfirm: options.rerunCodexOnConfirm === true,
          repairConflicts: options.repairConflicts === true,
          maxConflictRepairs,
          reusePolicy,
          ...(options.mockScenario === undefined ? {} : { mockScenario: options.mockScenario }),
          ...(forceStage === undefined ? {} : { forceStage }),
          ...(failAt === undefined ? {} : { failAt })
        });
        printChapterResult(result);
        return;
      }

      const chapterNumber = await resolveChapterSelector({
        projectId,
        projectsRoot,
        selector: chapterNumberText,
        regenerateStale: options.regenerateStale === true
      });

      if (options.dryRun) {
        const result = await runChapterDryRun({
          projectId,
          chapterNumber,
          candidates,
          projectsRoot,
          provider: options.provider ?? 'mock',
          ...codexOptions,
          ...(forceStage === undefined ? {} : { forceStage }),
          ...(failAt === undefined ? {} : { failAt })
        });

        console.log(`Chapter dry-run complete: ${result.projectId} chapter ${result.chapterNumber}`);
        console.log(`Run: ${result.runId}`);
        console.log('Artifacts:');
        for (const artifact of result.artifacts) {
          console.log(`- ${artifact}`);
        }
        return;
      }

      if (options.until !== 'draft') {
        if (options.until !== undefined) {
          throw new AppError('CHAPTER_STAGE_NOT_IMPLEMENTED', 'Use --dry-run for planning, --until draft for M7 drafting, or --max-revisions for M8 quality loop.', 2);
        }

        const result = await runChapterFullProduction({
          projectId,
          chapterNumber,
          projectsRoot,
          provider: options.provider ?? 'mock',
          ...codexOptions,
          candidates,
          ...(maxRevisions === undefined ? {} : { maxRevisions }),
          commit: options.commit === true,
          confirmCodexCommit: options.confirmCodexCommit === true,
          rerunCodexOnConfirm: options.rerunCodexOnConfirm === true,
          repairConflicts: options.repairConflicts === true,
          maxConflictRepairs,
          regenerateStale: options.regenerateStale === true,
          reusePolicy,
          ...(options.mockScenario === undefined ? {} : { mockScenario: options.mockScenario }),
          ...(forceStage === undefined ? {} : { forceStage }),
          ...(failAt === undefined ? {} : { failAt })
        });

        printChapterResult(result);
        return;
      }

      const result = await runChapterUntilDraft({
        projectId,
        chapterNumber,
        projectsRoot,
        provider: options.provider ?? 'mock',
        ...codexOptions,
        ...(forceStage === undefined ? {} : { forceStage }),
        ...(failAt === undefined ? {} : { failAt })
      });

      console.log(`Chapter draft complete: ${result.projectId} chapter ${result.chapterNumber}`);
      console.log(`Run: ${result.runId}`);
      console.log('Artifacts:');
      for (const artifact of result.artifacts) {
        console.log(`- ${artifact}`);
      }
    });
}

function printChapterResult(result: Awaited<ReturnType<typeof runChapterFullProduction>>): void {
  console.log(`Chapter pipeline complete: ${result.projectId} chapter ${result.chapterNumber}`);
  console.log(`resolvedChapterNumber: ${result.chapterNumber}`);
  console.log(`previousStatus: ${result.previousStatus ?? 'unknown'}`);
  console.log(`newStatus: ${result.newStatus ?? result.status}`);
  console.log(`currentStage: ${result.currentStage ?? 'unknown'}`);
  console.log(`resumeFromStage: ${result.resumeFromStage ?? 'none'}`);
  console.log(`commitStatus: ${result.commitStatus ?? (result.status === 'committed' ? 'committed' : 'not_requested')}`);
  if (result.repaired !== undefined) {
    console.log(`repaired: ${String(result.repaired)}`);
  }
  if (result.repairedPatchPath !== undefined) {
    console.log(`repairedPatchPath: ${result.repairedPatchPath}`);
  }
  if (result.conflictRepairReportPath !== undefined) {
    console.log(`conflictRepairReportPath: ${result.conflictRepairReportPath}`);
  }
  if (result.commitReportPath !== undefined) {
    console.log(`commitReportPath: ${result.commitReportPath}`);
  }
  if (result.previewOnly !== undefined) {
    console.log(`previewOnly: ${String(result.previewOnly)}`);
  }
  if (result.codexPatchPath !== undefined) {
    console.log(`codexPatchPath: ${result.codexPatchPath}`);
  }
  if (result.stateDiffPath !== undefined) {
    console.log(`stateDiffPath: ${result.stateDiffPath}`);
  }
  if (result.approvalRecordPath !== undefined) {
    console.log(`approvalRecordPath: ${result.approvalRecordPath}`);
  }
  if (result.codexCommitReportPath !== undefined) {
    console.log(`codexCommitReportPath: ${result.codexCommitReportPath}`);
  }
  if (result.suggestedNextCommand !== undefined) {
    console.log(`suggestedNextCommand: ${result.suggestedNextCommand}`);
  }
  if (result.reusedPreviewArtifacts !== undefined) {
    console.log(`reusedPreviewArtifacts: ${String(result.reusedPreviewArtifacts)}`);
  }
  if (result.reusedPatchPath !== undefined) {
    console.log(`reusedPatchPath: ${result.reusedPatchPath}`);
  }
  if (result.reusedStateDiffPath !== undefined) {
    console.log(`reusedStateDiffPath: ${result.reusedStateDiffPath}`);
  }
  if (result.normalizedPatchPath !== undefined) {
    console.log(`normalizedPatchPath: ${result.normalizedPatchPath}`);
  }
  if (result.consistencyReportPath !== undefined) {
    console.log(`consistencyReportPath: ${result.consistencyReportPath}`);
  }
  if (result.qualityReportPath !== undefined) {
    console.log(`qualityReportPath: ${result.qualityReportPath}`);
  }
  if (result.reusePolicyRequested !== undefined) {
    console.log(`reusePolicyRequested: ${result.reusePolicyRequested}`);
  }
  if (result.reusePolicyEffective !== undefined) {
    console.log(`reusePolicyEffective: ${result.reusePolicyEffective}`);
  }
  if (result.reusePolicyReportPath !== undefined) {
    console.log(`reusePolicyReportPath: ${result.reusePolicyReportPath}`);
  }
  if (result.regeneratedChapterNumber !== undefined) {
    console.log(`regeneratedChapterNumber: ${result.regeneratedChapterNumber}`);
  }
  if (result.archiveManifestPath !== undefined) {
    console.log(`archiveManifestPath: ${result.archiveManifestPath}`);
  }
  if (result.oldArtifactsArchivedCount !== undefined) {
    console.log(`oldArtifactsArchivedCount: ${result.oldArtifactsArchivedCount}`);
  }
  if (result.remainingStaleChapters !== undefined) {
    console.log(`remainingStaleChapters: ${result.remainingStaleChapters.join(', ') || 'none'}`);
  }
  console.log(`Run: ${result.runId}`);
  if (result.runIds.planning !== undefined || result.runIds.draft !== undefined) {
    console.log('Stage runs:');
    if (result.runIds.planning !== undefined) {
      console.log(`- planning: ${result.runIds.planning}`);
    }
    if (result.runIds.draft !== undefined) {
      console.log(`- draft: ${result.runIds.draft}`);
    }
    console.log(`- revision: ${result.runIds.revision}`);
  }
  console.log('reusedArtifacts:');
  for (const artifact of result.reusedArtifacts) {
    console.log(`- ${artifact}`);
  }
  console.log('generatedArtifacts:');
  for (const artifact of result.generatedArtifacts) {
    console.log(`- ${artifact}`);
  }
  console.log('Artifacts:');
  for (const artifact of result.artifacts) {
    console.log(`- ${artifact}`);
  }
}

export interface ResolveChapterSelectorInput {
  projectId: string;
  projectsRoot: string;
  selector: string;
  regenerateStale?: boolean;
}

export async function resolveChapterSelector(input: ResolveChapterSelectorInput, fileStore = new FileStore()): Promise<number> {
  if (input.selector === 'next') {
    const paths = new ProjectPaths(input.projectsRoot, input.projectId);
    if (input.regenerateStale === true) {
      const staleChapter = await new ChapterQueueStore(paths, fileStore).findEarliestStaleChapter();
      if (staleChapter === undefined) {
        throw new AppError('NO_STALE_CHAPTER', 'No stale chapter is available for --regenerate-stale.', 2, {
          suggestedNextCommand: `novel-loop stale ${input.projectId}`
        });
      }
      return staleChapter.chapterNumber;
    }
    const state = await fileStore.readJson(paths.storyState(), StoryStateSchema);
    return state.latestCommittedChapter + 1;
  }

  return parsePositiveInteger(input.selector, 'chapterNumber');
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a non-negative integer`, 2);
  }

  return parsed;
}

function parseForceStage(value: string): ChapterQueueStage {
  return ChapterQueueStageSchema.parse(value);
}

function parseFailurePoint(value: string): FailureInjectionPoint {
  if (value === 'write_scene_002' || value === 'extract_canon_patch') {
    return value;
  }
  return ChapterQueueStageSchema.parse(value);
}

function parseReusePolicy(value: string): ReusePolicy {
  return ReusePolicySchema.parse(value);
}
