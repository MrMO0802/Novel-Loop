import type { Command } from 'commander';

import { recommitChapter } from '../../app/recommitChapter.js';
import type { ProviderName } from '../../llm/ProviderFactory.js';
import { AppError } from '../../utils/AppError.js';
import { PROJECTS_ROOT_OPTION_HELP, PROVIDER_OPTION_HELP } from '../help.js';

interface RecommitCommandOptions {
  root?: string;
  provider?: ProviderName;
  fromFinal?: boolean;
  fromPatch?: string;
  confirm?: boolean;
  mockScenario?: string;
  allowHistoricalRecommit?: boolean;
  markDownstreamStale?: boolean;
}

export function registerRecommitCommand(program: Command): void {
  program
    .command('recommit')
    .description('Controlled manual recommit from final.md or canon patch')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<chapterNumber>', 'chapter number')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--provider <provider>', PROVIDER_OPTION_HELP, 'mock')
    .option('--from-final', 'extract a fresh manual canon patch from final.md', false)
    .option('--from-patch <path>', 'use a manually edited canon patch file')
    .option('--confirm', 'apply the recommit after preview and approval record', false)
    .option('--mock-scenario <scenario>', 'mock provider scenario for manual final extraction')
    .option('--allow-historical-recommit', 'allow recommit for a historical chapter only with downstream invalidation', false)
    .option('--mark-downstream-stale', 'mark downstream chapters stale when historical recommit is allowed', false)
    .action(async (projectId: string, chapterNumberText: string, options: RecommitCommandOptions) => {
      if (options.fromFinal === true && options.fromPatch !== undefined) {
        throw new AppError('RECOMMIT_SOURCE_CONFLICT', 'Use --from-final or --from-patch, not both.', 2);
      }
      if (options.fromFinal !== true && options.fromPatch === undefined) {
        throw new AppError('RECOMMIT_SOURCE_REQUIRED', 'Use --from-final or --from-patch <path>.', 2);
      }
      const result = await recommitChapter({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapterNumber: parsePositiveInteger(chapterNumberText, 'chapterNumber'),
        sourceType: options.fromFinal === true ? 'final' : 'patch',
        ...(options.fromPatch === undefined ? {} : { patchPath: options.fromPatch }),
        provider: options.provider ?? 'mock',
        confirm: options.confirm === true,
        ...(options.mockScenario === undefined ? {} : { mockScenario: options.mockScenario }),
        allowHistoricalRecommit: options.allowHistoricalRecommit === true,
        markDownstreamStale: options.markDownstreamStale === true
      });

      console.log(`Recommit complete: ${projectId} chapter ${result.chapterNumber}`);
      console.log(`previewOnly: ${String(result.previewOnly)}`);
      console.log(`generatedPatchPath: ${result.generatedPatchPath}`);
      console.log(`stateDiffPath: ${result.stateDiffPath}`);
      console.log(`recommitReportPath: ${result.recommitReportPath}`);
      if (result.historicalRecommit !== undefined) {
        console.log(`historicalRecommit: ${String(result.historicalRecommit)}`);
      }
      if (result.oldLatestCommittedChapter !== undefined) {
        console.log(`oldLatestCommittedChapter: ${result.oldLatestCommittedChapter}`);
      }
      if (result.newLatestCommittedChapter !== undefined) {
        console.log(`newLatestCommittedChapter: ${result.newLatestCommittedChapter}`);
        console.log(`proposedNewLatestCommittedChapter: ${result.newLatestCommittedChapter}`);
      }
      if (result.chapterNumber !== undefined && result.historicalRecommit === true) {
        console.log(`editedChapterNumber: ${result.chapterNumber}`);
      }
      if (result.baseSnapshotId !== undefined) {
        console.log(`baseSnapshotId: ${result.baseSnapshotId}`);
      }
      if (result.downstreamInvalidationReportPath !== undefined) {
        console.log(`downstreamInvalidationReportPath: ${result.downstreamInvalidationReportPath}`);
        console.log(`downstreamInvalidationPreviewPath: ${result.downstreamInvalidationReportPath}`);
      }
      if (result.historicalRecommitReportPath !== undefined) {
        console.log(`historicalRecommitReportPath: ${result.historicalRecommitReportPath}`);
      }
      if (result.regenerationPlanPath !== undefined) {
        console.log(`regenerationPlanPath: ${result.regenerationPlanPath}`);
      }
      if (result.staleChapters !== undefined) {
        console.log(`staleChapters: ${result.staleChapters.join(', ') || 'none'}`);
        console.log(`downstreamChaptersToInvalidate: ${result.staleChapters.join(', ') || 'none'}`);
      }
      if (result.suggestedNextCommand !== undefined) {
        console.log(`suggestedNextCommand: ${result.suggestedNextCommand}`);
      }
      if (result.approvalRecordPath !== undefined) {
        console.log(`approvalRecordPath: ${result.approvalRecordPath}`);
      }
      if (result.beforeSnapshotId !== undefined) {
        console.log(`beforeSnapshotId: ${result.beforeSnapshotId}`);
      }
      if (result.afterSnapshotId !== undefined) {
        console.log(`afterSnapshotId: ${result.afterSnapshotId}`);
      }
      console.log(`committed: ${String(result.committed)}`);
      console.log(`queueStatus: ${result.queueStatus}`);
      if (result.previewOnly) {
        console.log('message: No state was modified. Re-run with --confirm to apply.');
      }
    });
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new AppError('INVALID_NUMBER', `${label} must be a positive integer`, 2);
  }
  return parsed;
}
