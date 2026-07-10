import type { Command } from 'commander';

import { checkCodexStatus, execCodexJson, execCodexText, runCodexSmoke } from '../../app/codexBoundary.js';
import { generateCodexBusinessOptimizationPlan } from '../../app/codexBusinessOptimizationPlan.js';
import { generateCodexCallReductionReport } from '../../app/codexCallReduction.js';
import { generateCodexChapterRegressionAnalysis } from '../../app/codexChapterRegressionAnalysis.js';
import { generateCodexDiagnosticsHardFailAnalysis, runCodexDiagnosticsBenchmark } from '../../app/codexDiagnosticsHardFailAnalysis.js';
import { evaluateCodexCrossChapterContinuity } from '../../app/codexCrossChapterContinuity.js';
import { runCodexMissionMicroBenchmark } from '../../app/codexMissionMicroBenchmark.js';
import { evaluateCodexCrossChapterDrift, runCodexMultiChapterPilot } from '../../app/codexMultiChapterPilot.js';
import { runCodexProfileComparison, runCodexRuntimeBenchmark } from '../../app/codexRuntimeBenchmark.js';
import { generateCodexRuntimeGapReport } from '../../app/codexRuntimeGap.js';
import { generateCodexRuntimeOptimizationReport } from '../../app/codexRuntimeOptimization.js';
import { profileCodexRuntime } from '../../app/codexRuntimeProfiler.js';
import { runCodexRuntimeStageSampling } from '../../app/codexRuntimeSampling.js';
import { runCodexSingleChapterSmoke } from '../../app/codexSingleChapterSmoke.js';
import { inspectProvider } from '../../providers/providerRegistry.js';
import { AppError } from '../../utils/AppError.js';
import { resolveCodexCliOptions } from '../codexOptions.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface CodexCommandOptions {
  codexBin?: string;
  root?: string;
  projectId?: string;
  json?: boolean;
  prompt?: string;
  schema?: string;
  brief?: string;
  promptRoot?: string;
  chapters?: string;
  resume?: boolean;
  confirm?: boolean;
  codexProfile?: string;
  codexJsonRetries?: string;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: string;
  codexTimeoutMs?: string;
  codexContextBudgetBytes?: string;
  codexMaxArtifactsInContext?: string;
  codexContextMode?: string;
  codexStageTimeoutMs?: string;
  codexMaxTotalRuntimeMs?: string;
  codexMaxCallsPerStage?: string;
  codexMaxCallsPerChapter?: string;
  codexMaxRuntimeMsPerChapter?: string;
  timeoutMs?: string;
  maxTotalRuntimeMs?: string;
  level?: string;
  continueOnFailure?: boolean;
  compareProfiles?: string;
  profileStages?: boolean;
  beforeCallCount?: string;
  afterCallCount?: string;
  realBenchmark?: boolean;
  sourceProfile?: string;
  optimizationMode?: string;
  codexFinalMode?: string;
  useCache?: boolean;
  warmCache?: boolean;
  chapter?: string;
  stage?: string;
  samples?: string;
}

export function registerCodexCommand(program: Command): void {
  const codex = program.command('codex').description('Run local Codex CLI within a read-only execution boundary');
  addBoundaryOptions(codex);

  addBoundaryOptions(codex.command('status').description('Check local Codex CLI binary, login status, and doctor health')).action(async (options: CodexCommandOptions, command: Command) => {
    options = mergedOptions(options, command);
    const result = await checkCodexStatus(baseOptions(options));
    const provider = await inspectProvider('codex-text', baseOptions(options));
    const health = provider.health;
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify({ ...result, ...health, binaryFound: result.binaryFound, healthOk: result.healthOk }, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      [
        `codexStatus: ${health.providerAvailable ? 'available' : 'unavailable'}`,
        `binaryFound: ${result.binaryFound}`,
        `binaryAvailable: ${health.binaryAvailable}`,
        `binaryPath: ${result.binaryPath}`,
        `version: ${result.version}`,
        `loginStatus: ${result.loginStatus}`,
        `loginAvailable: ${health.loginAvailable}`,
        `doctorHealthy: ${health.doctorHealthy}`,
        `healthOk: ${result.healthOk}`,
        `doctorWarning: ${health.doctorHealthy ? 'none' : 'non-blocking if smoke/json pass'}`,
        `execSmokeOk: ${health.execSmokeOk}`,
        `execJsonOk: ${health.execJsonOk}`,
        `providerAvailable: ${health.providerAvailable}`,
        `sandboxDefault: ${result.sandbox}`
      ].join('\n') + '\n'
    );
  });

  addBoundaryOptions(codex.command('smoke').description('Run a read-only Codex exec smoke test')).action(async (options: CodexCommandOptions, command: Command) => {
    options = mergedOptions(options, command);
    const result = await runCodexSmoke(baseOptions(options));
    process.stdout.write(
      [
        `codexSmoke: ${result.ok ? 'success' : 'failed'}`,
        `sandbox: ${result.sandbox}`,
        `runId: ${result.runId}`,
        `rawOutputPath: ${result.rawOutputPath}`,
        `finalOutputPath: ${result.finalOutputPath}`
      ].join('\n') + '\n'
    );
  });

  addBoundaryOptions(codex.command('exec-text').description('Run Codex exec against a prompt file and save text output'))
    .requiredOption('--prompt <path>', 'prompt markdown file')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await execCodexText({
        ...baseOptions(options),
        promptPath: requiredOption(options.prompt, 'prompt')
      });
      process.stdout.write(
        [
          'codexExecText: success',
          `sandbox: ${result.sandbox}`,
          `runId: ${result.runId}`,
          `rawOutputPath: ${result.rawOutputPath}`,
          `finalOutputPath: ${result.finalOutputPath}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('exec-json').description('Run Codex exec with --output-schema and save parsed JSON output'))
    .requiredOption('--prompt <path>', 'prompt markdown file')
    .requiredOption('--schema <path>', 'JSON schema file passed to codex exec --output-schema')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await execCodexJson({
        ...baseOptions(options),
        promptPath: requiredOption(options.prompt, 'prompt'),
        schemaPath: requiredOption(options.schema, 'schema')
      });
      process.stdout.write(
        [
          'codexExecJson: success',
          `sandbox: ${result.sandbox}`,
          `runId: ${result.runId}`,
          `rawOutputPath: ${result.rawOutputPath}`,
          `finalOutputPath: ${result.finalOutputPath}`,
          `parsedJsonPath: ${result.parsedJsonPath}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('single-chapter-smoke').description('Run a controlled Codex single-chapter full-loop smoke'))
    .option('--brief <path>', 'brief markdown path', './examples/brief.md')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexSingleChapterSmoke({
        projectId: options.projectId ?? 'codex-single',
        projectsRoot: options.root ?? './projects',
        briefPath: options.brief ?? './examples/brief.md',
        promptRoot: options.promptRoot ?? './prompts',
        ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
        codexProfile: 'clean',
        codexJsonRetries: 2,
        codexJsonRepair: true
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `codexSingleChapterSmoke: ${result.report.success ? 'success' : 'failed'}`,
            `reportPath: ${result.reportPath}`,
            `markdownPath: ${result.markdownPath}`,
            `previewRunId: ${result.report.previewRunId ?? 'none'}`,
            `confirmedRunId: ${result.report.confirmedRunId ?? 'none'}`,
            `latestCommittedChapterAfter: ${result.report.latestCommittedChapterAfter}`,
            `qualityReportPath: ${result.report.qualityReportPath ?? 'none'}`
          ].join('\n') + '\n'
        );
      }
      if (!result.report.success) {
        process.exitCode = 1;
      }
    });

  addCodexPilotOptions(addBoundaryOptions(codex.command('multi-chapter-pilot').description('[experimental] Run a controlled Codex multi-chapter pilot')))
    .option('--brief <path>', 'brief markdown path', './examples/brief.md')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .option('--chapters <count>', 'target chapter count', '3')
    .option('--resume', 'resume an existing Codex multi-chapter pilot project', false)
    .option('--confirm', 'blocked: one-shot batch confirmation is not allowed', false)
    .option('--codex-max-calls-per-chapter <count>', 'maximum Codex prompt calls per chapter', '20')
    .option('--codex-max-runtime-ms-per-chapter <ms>', 'maximum runtime per chapter', '900000')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexMultiChapterPilot({
        projectId: options.projectId ?? 'codex-multi',
        projectsRoot: options.root ?? './projects',
        briefPath: options.brief ?? './examples/brief.md',
        promptRoot: options.promptRoot ?? './prompts',
        targetChapterCount: parsePositiveInteger(options.chapters ?? '3', 'chapters'),
        ...resolveCodexCliOptions({
          ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
          codexProfile: options.codexProfile ?? 'clean',
          codexJsonRetries: options.codexJsonRetries ?? '2',
          ...(options.codexJsonRepair === undefined ? {} : { codexJsonRepair: options.codexJsonRepair }),
          codexJsonRepairRetries: options.codexJsonRepairRetries ?? '1',
          codexTimeoutMs: options.codexTimeoutMs ?? '180000',
          codexContextMode: options.codexContextMode ?? 'compact',
          ...(options.codexContextBudgetBytes === undefined ? {} : { codexContextBudgetBytes: options.codexContextBudgetBytes }),
          ...(options.codexMaxArtifactsInContext === undefined ? {} : { codexMaxArtifactsInContext: options.codexMaxArtifactsInContext })
        }),
        codexMaxCallsPerChapter: parseNonNegativeInteger(options.codexMaxCallsPerChapter ?? '20', 'codexMaxCallsPerChapter'),
        codexMaxRuntimeMsPerChapter: parsePositiveInteger(options.codexMaxRuntimeMsPerChapter ?? '900000', 'codexMaxRuntimeMsPerChapter'),
        resume: options.resume === true,
        batchConfirm: options.confirm === true
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `codexMultiChapterPilot: ${result.report.success ? 'success' : 'failed'}`,
            `reportPath: ${result.reportPath}`,
            `markdownPath: ${result.markdownPath}`,
            `completedChapterCount: ${result.report.completedChapterCount}`,
            `latestCommittedChapterAfter: ${result.report.latestCommittedChapterAfter}`,
            `crossChapterDriftReportPath: ${result.report.crossChapterDriftReportPath ?? 'none'}`,
            `crossChapterContinuityReportPath: ${result.report.crossChapterContinuityReportPath ?? 'none'}`,
            `failureReportPath: ${result.report.failureReportPath ?? 'none'}`
          ].join('\n') + '\n'
        );
      }
      if (!result.report.success) {
        process.exitCode = 1;
      }
    });

  addCodexBenchmarkOptions(addBoundaryOptions(codex.command('benchmark').description('[pilot diagnostic] Run progressive Codex runtime benchmark levels')))
    .option('--brief <path>', 'brief markdown path', './examples/brief.md')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const common = {
        projectId: options.projectId ?? 'codex-bench',
        projectsRoot: options.root ?? './projects',
        briefPath: options.brief ?? './examples/brief.md',
        promptRoot: options.promptRoot ?? './prompts',
        ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
        level: parseBenchmarkLevel(options.level ?? 'all'),
        codexProfile: parseCodexProfile(options.codexProfile ?? 'clean'),
        codexJsonRetries: parseNonNegativeInteger(options.codexJsonRetries ?? '2', 'codexJsonRetries'),
        codexJsonRepair: options.codexJsonRepair ?? true,
        codexJsonRepairRetries: parseNonNegativeInteger(options.codexJsonRepairRetries ?? '1', 'codexJsonRepairRetries'),
        codexTimeoutMs: parsePositiveInteger(options.codexTimeoutMs ?? options.timeoutMs ?? '180000', 'codexTimeoutMs'),
        codexContextMode: parseCodexContextMode(options.codexContextMode ?? 'compact'),
        codexFinalMode: parseCodexFinalMode(options.codexFinalMode ?? 'codex'),
        ...(options.optimizationMode === undefined ? {} : { optimizationMode: parseOptimizationMode(options.optimizationMode) }),
        useCache: options.useCache === true,
        warmCache: options.warmCache === true,
        ...(options.codexContextBudgetBytes === undefined ? {} : { codexContextBudgetBytes: parsePositiveInteger(options.codexContextBudgetBytes, 'codexContextBudgetBytes') }),
        ...(options.codexMaxArtifactsInContext === undefined ? {} : { codexMaxArtifactsInContext: parsePositiveInteger(options.codexMaxArtifactsInContext, 'codexMaxArtifactsInContext') }),
        codexStageTimeoutMs: parsePositiveInteger(options.codexStageTimeoutMs ?? options.timeoutMs ?? '180000', 'codexStageTimeoutMs'),
        ...(options.codexMaxTotalRuntimeMs === undefined && options.maxTotalRuntimeMs === undefined
          ? {}
          : { codexMaxTotalRuntimeMs: parsePositiveInteger(options.codexMaxTotalRuntimeMs ?? options.maxTotalRuntimeMs ?? '1', 'codexMaxTotalRuntimeMs') }),
        ...(options.codexMaxCallsPerStage === undefined ? {} : { codexMaxCallsPerStage: parseNonNegativeInteger(options.codexMaxCallsPerStage, 'codexMaxCallsPerStage') }),
        ...(options.codexMaxCallsPerChapter === undefined ? {} : { codexMaxCallsPerChapter: parseNonNegativeInteger(options.codexMaxCallsPerChapter, 'codexMaxCallsPerChapter') }),
        continueOnFailure: options.continueOnFailure === true,
        resume: options.resume === true
      };
      const result =
        options.compareProfiles === undefined
          ? await runCodexRuntimeBenchmark(common)
          : await runCodexProfileComparison({
              ...common,
              level: common.level === 'all' ? 'health' : common.level,
              profiles: parseProfiles(options.compareProfiles)
            });
      const profile =
        options.profileStages === true
          ? await profileCodexRuntime({ projectId: common.projectId, projectsRoot: common.projectsRoot })
          : undefined;
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(profile === undefined ? result : { ...result, stageProfile: profile }, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `codexBenchmark: ${result.report.success ? 'success' : 'failed'}`,
            `reportPath: ${result.reportPath}`,
            `markdownPath: ${result.markdownPath}`,
            `profile: ${result.report.profile}`,
            `completedLevels: ${result.report.completedLevels.join(',') || 'none'}`,
            `failedLevel: ${result.report.failedLevel ?? 'none'}`,
            `totalDurationMs: ${result.report.totalDurationMs}`,
            `stageCount: ${result.report.stages.length}`,
            ...(profile === undefined ? [] : [`stageProfilePath: ${profile.reportPath}`]),
            `realOptimizationReportPath: ${result.realOptimizationReportPath ?? 'none'}`,
            `failureReportPath: ${result.report.failureReportPath ?? 'none'}`
          ].join('\n') + '\n'
        );
      }
      if (!result.report.success) {
        process.exitCode = 1;
      }
    });

  addBoundaryOptions(codex.command('profile-runtime').description('[experimental/internal] Profile Codex runtime from existing run manifests and benchmark reports without executing Codex'))
    .argument('<projectId>', 'project id')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await profileCodexRuntime({
        projectId,
        projectsRoot: options.root ?? './projects'
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexRuntimeProfile: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `totalDurationMs: ${result.report.totalDurationMs}`,
          `sourceRunCount: ${result.report.sourceRunCount}`,
          `slowestStages: ${result.report.slowestStages.map((stage) => stage.stage).join(',') || 'none'}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('optimization-plan').description('[experimental/internal] Generate a read-only Codex business optimization plan from the latest runtime profile'))
    .argument('<projectId>', 'project id')
    .option('--source-profile <path>', 'relative source codex_stage_runtime_profile_vN.json path')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexBusinessOptimizationPlan({
        projectId,
        projectsRoot: options.root ?? './projects',
        ...(options.sourceProfile === undefined ? {} : { sourceProfilePath: options.sourceProfile })
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexBusinessOptimizationPlan: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `sourceProfilePath: ${result.report.sourceProfilePath}`,
          `businessTotalDurationMs: ${result.report.businessTotalDurationMs}`,
          `rawTotalDurationMs: ${result.report.rawTotalDurationMs}`,
          `wrapperDurationMs: ${result.report.wrapperDurationMs}`,
          `candidateCount: ${result.report.optimizationCandidates.length}`,
          `topCandidate: ${result.report.optimizationCandidates[0]?.candidateId ?? 'none'}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('call-reduction').description('[experimental/internal] Write a local deterministic Codex call reduction report'))
    .argument('<projectId>', 'project id')
    .option('--before-call-count <count>', 'baseline Codex call count')
    .option('--after-call-count <count>', 'current Codex call count')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexCallReductionReport({
        projectId,
        projectsRoot: options.root ?? './projects',
        ...(options.beforeCallCount === undefined ? {} : { beforeCallCount: parseNonNegativeInteger(options.beforeCallCount, 'beforeCallCount') }),
        ...(options.afterCallCount === undefined ? {} : { afterCallCount: parseNonNegativeInteger(options.afterCallCount, 'afterCallCount') })
      });
      process.stdout.write(
        [
          'codexCallReduction: success',
          `reportPath: ${result.reportPath}`,
          `beforeCallCount: ${result.report.beforeCallCount}`,
          `afterCallCount: ${result.report.afterCallCount}`,
          `schemaSafetyChecksPreserved: ${String(result.report.schemaSafetyChecksPreserved)}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('optimize-runtime').description('[experimental/internal] Compare Codex runtime metrics against the M26.5 baseline'))
    .argument('<projectId>', 'project id')
    .option('--real-benchmark', 'mark report as generated from a real Codex benchmark', false)
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexRuntimeOptimizationReport({
        projectId,
        projectsRoot: options.root ?? './projects',
        realBenchmark: options.realBenchmark === true
      });
      process.stdout.write(
        [
          'codexRuntimeOptimization: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `realBenchmark: ${String(result.report.realBenchmark)}`,
          `improvedStages: ${result.report.improvedStages.join(',') || 'none'}`,
          `regressedStages: ${result.report.regressedStages.join(',') || 'none'}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('regression-analysis').description('[experimental/internal] Analyze chapter2/chapter3 Codex runtime regressions from existing artifacts'))
    .argument('<projectId>', 'project id')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexChapterRegressionAnalysis({
        projectId,
        projectsRoot: options.root ?? './projects'
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexChapterRegressionAnalysis: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `currentBenchmarkPath: ${result.report.currentBenchmarkPath}`,
          `regressedChapters: ${result.report.regressions.map((chapter) => chapter.chapterNumber).join(',') || 'none'}`,
          `duplicatePromptCalls: ${result.report.duplicatePromptCalls.length}`,
          `topRootCause: ${result.report.suspectedRootCauses[0]?.rootCauseId ?? 'none'}`,
          `recommendedFixes: ${result.report.recommendedFixes.length}`
        ].join('\n') + '\n'
      );
    });

  addBoundaryOptions(codex.command('runtime-gap').description('[experimental/internal] Analyze wall-clock vs prompt-call runtime gaps from existing artifacts'))
    .argument('<projectId>', 'project id')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexRuntimeGapReport({
        projectId,
        projectsRoot: options.root ?? './projects'
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexRuntimeGap: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `totalWallClockMs: ${result.report.totalWallClockMs}`,
          `totalPromptCallMs: ${result.report.totalPromptCallMs}`,
          `totalLocalStageMs: ${result.report.totalLocalStageMs}`,
          `totalUnattributedGapMs: ${result.report.totalUnattributedGapMs}`,
          `measuredCodexBoundaryMs: ${result.report.measuredCodexBoundaryMs}`,
          `measuredLocalProcessingMs: ${result.report.measuredLocalProcessingMs}`,
          `unexplainedMsAfterPrecision: ${result.report.unexplainedMsAfterPrecision}`,
          `timingOverlapDetected: ${String(result.report.timingOverlapDetected)}`,
          `largestGapRun: ${result.report.gapByRun[0]?.runId ?? 'none'}`
        ].join('\n') + '\n'
      );
    });

  addCodexPilotOptions(addBoundaryOptions(codex.command('sample-stage').description('[experimental/internal] Run targeted Codex runtime samples for one stage without canonical writes')))
    .argument('<projectId>', 'project id')
    .requiredOption('--chapter <number>', 'chapter number')
    .requiredOption('--stage <stage>', 'stage: chapter_mission, scene_cards, write_scene, canon_patch_proposal, diagnostics, final_chapter')
    .option('--samples <count>', 'sample count', '1')
    .option('--timeout-ms <ms>', 'alias for codex timeout', '180000')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexRuntimeStageSampling({
        projectId,
        projectsRoot: options.root ?? './projects',
        promptRoot: options.promptRoot ?? './prompts',
        chapterNumber: parsePositiveInteger(requiredOption(options.chapter, 'chapter'), 'chapter'),
        stage: parseSamplingStage(requiredOption(options.stage, 'stage')),
        samples: parsePositiveInteger(options.samples ?? '1', 'samples'),
        ...resolveCodexCliOptions({
          ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
          codexProfile: options.codexProfile ?? 'clean',
          codexJsonRetries: options.codexJsonRetries ?? '2',
          ...(options.codexJsonRepair === undefined ? {} : { codexJsonRepair: options.codexJsonRepair }),
          codexJsonRepairRetries: options.codexJsonRepairRetries ?? '1',
          codexTimeoutMs: options.codexTimeoutMs ?? options.timeoutMs ?? '180000'
        })
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexRuntimeSampling: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `chapterNumber: ${result.report.chapterNumber}`,
          `stage: ${result.report.stage}`,
          `promptId: ${result.report.promptId}`,
          `sampleCount: ${result.report.sampleCount}`,
          `successCount: ${result.report.successCount}`,
          `failureCount: ${result.report.failureCount}`,
          `medianDurationMs: ${result.report.medianDurationMs}`,
          `p95DurationMs: ${result.report.p95DurationMs}`,
          `retryRate: ${result.report.retryRate}`,
          `schemaValidRate: ${result.report.schemaValidRate}`,
          `stableBottleneck: ${String(result.report.interpretation.stableBottleneck)}`,
          `likelyRuntimeVariance: ${String(result.report.interpretation.likelyRuntimeVariance)}`,
          `recommendation: ${result.report.recommendation}`
        ].join('\n') + '\n'
      );
      if (result.report.failureCount > 0) process.exitCode = 1;
    });

  addCodexPilotOptions(addBoundaryOptions(codex.command('mission-benchmark').description('[pilot diagnostic] Run only Codex chapter mission generation and record retry/schema diagnostics')))
    .argument('<projectId>', 'project id')
    .requiredOption('--chapter <number>', 'chapter number')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (projectId: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexMissionMicroBenchmark({
        projectId,
        projectsRoot: options.root ?? './projects',
        promptRoot: options.promptRoot ?? './prompts',
        chapterNumber: parsePositiveInteger(requiredOption(options.chapter, 'chapter'), 'chapter'),
        ...resolveCodexCliOptions({
          ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
          codexProfile: options.codexProfile ?? 'clean',
          codexJsonRetries: options.codexJsonRetries ?? '2',
          ...(options.codexJsonRepair === undefined ? {} : { codexJsonRepair: options.codexJsonRepair }),
          codexJsonRepairRetries: options.codexJsonRepairRetries ?? '1',
          codexTimeoutMs: options.codexTimeoutMs ?? options.timeoutMs ?? '180000'
        })
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `codexMissionBenchmark: ${result.report.success ? 'success' : 'failed'}`,
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `retryReportPath: ${result.retryReportPath}`,
          `schemaDiagnosticsPath: ${result.schemaDiagnosticsPath}`,
          `chapterNumber: ${result.report.chapterNumber}`,
          `retryCount: ${result.report.retryCount}`,
          `repairCount: ${result.report.repairCount}`,
          `schemaValid: ${String(result.report.schemaValid)}`
        ].join('\n') + '\n'
      );
      if (!result.report.success) process.exitCode = 1;
    });

  addBoundaryOptions(codex.command('diagnostics-analysis').description('[experimental/internal] Analyze an existing Codex diagnostics hard fail without executing Codex'))
    .argument('<projectId>', 'project id')
    .argument('<chapterNumber>', 'chapter number')
    .action(async (projectId: string, chapterNumber: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await generateCodexDiagnosticsHardFailAnalysis({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapterNumber: parsePositiveInteger(chapterNumber, 'chapterNumber')
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexDiagnosticsAnalysis: success',
          `analysisPath: ${result.analysisPath}`,
          `contextAuditPath: ${result.contextAuditPath}`,
          `revisionOpportunityPath: ${result.revisionOpportunityPath}`,
          `hardFailures: ${result.analysis.hardFailures.length}`,
          `falsePositiveRisk: ${result.analysis.falsePositiveRisk.level}`,
          `suggestedRetryCommand: ${result.analysis.suggestedRetryCommand}`
        ].join('\n') + '\n'
      );
    });

  addCodexPilotOptions(addBoundaryOptions(codex.command('diagnostics-benchmark').description('[pilot diagnostic] Re-run only Codex diagnostics samples without canonical writes')))
    .argument('<projectId>', 'project id')
    .argument('<chapterNumber>', 'chapter number')
    .option('--samples <count>', 'sample count', '1')
    .option('--timeout-ms <ms>', 'alias for codex timeout', '180000')
    .option('--prompt-root <path>', 'prompt root directory', './prompts')
    .action(async (projectId: string, chapterNumber: string, options: CodexCommandOptions, command: Command) => {
      options = mergedOptions(options, command);
      const result = await runCodexDiagnosticsBenchmark({
        projectId,
        projectsRoot: options.root ?? './projects',
        promptRoot: options.promptRoot ?? './prompts',
        chapterNumber: parsePositiveInteger(chapterNumber, 'chapterNumber'),
        samples: parsePositiveInteger(options.samples ?? '1', 'samples'),
        ...resolveCodexCliOptions({
          ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
          codexProfile: options.codexProfile ?? 'clean',
          codexJsonRetries: options.codexJsonRetries ?? '2',
          ...(options.codexJsonRepair === undefined ? {} : { codexJsonRepair: options.codexJsonRepair }),
          codexJsonRepairRetries: options.codexJsonRepairRetries ?? '1',
          codexTimeoutMs: options.codexTimeoutMs ?? options.timeoutMs ?? '180000'
        })
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          'codexDiagnosticsBenchmark: success',
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `sampleCount: ${result.report.sampleCount}`,
          `hardFailRate: ${result.report.hardFailRate}`,
          `schemaValidRate: ${result.report.schemaValidRate}`,
          `stableFailure: ${String(result.report.stableFailure)}`,
          `recommendation: ${result.report.recommendation}`
        ].join('\n') + '\n'
      );
    });

  program
    .command('evaluate-continuity')
    .description('[experimental/internal] Run local deterministic Codex cross-chapter drift checks')
    .argument('<projectId>', 'project id')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--chapters <range>', 'chapter range, e.g. 1-3', '1-3')
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, options: CodexCommandOptions) => {
      const result = await evaluateCodexCrossChapterDrift({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapters: parseChapterRange(options.chapters ?? '1-3')
      });
      const continuity = await evaluateCodexCrossChapterContinuity({
        projectId,
        projectsRoot: options.root ?? './projects',
        chapters: parseChapterRange(options.chapters ?? '1-3')
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify({ drift: result, continuity }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        [
          `crossChapterDrift: ${result.report.blockingIssues.length === 0 ? 'pass' : 'blocked'}`,
          `reportPath: ${result.reportPath}`,
          `markdownPath: ${result.markdownPath}`,
          `continuityReportPath: ${continuity.reportPath}`,
          `continuityScore: ${continuity.report.continuityScore}`,
          `blockingIssues: ${result.report.blockingIssues.length}`,
          `warnings: ${result.report.warnings.length + continuity.report.warnings.length}`
        ].join('\n') + '\n'
      );
      if (result.report.blockingIssues.length > 0 || continuity.report.blockingIssues.length > 0) {
        process.exitCode = 1;
      }
    });
}

function mergedOptions(options: CodexCommandOptions, command: Command): CodexCommandOptions {
  return {
    ...options,
    ...(command.optsWithGlobals() as CodexCommandOptions)
  };
}

function addBoundaryOptions(command: Command): Command {
  return command
    .option('--codex-bin <path>', 'path to local codex CLI binary')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--project-id <projectId>', 'project id used for Codex provenance artifacts', 'codex-boundary')
    .option('--json', 'print JSON output', false);
}

function addCodexPilotOptions(command: Command): Command {
  return command
    .option('--codex-profile <profile>', 'codex runtime profile: default, clean, or debug', 'clean')
    .option('--codex-json-retries <count>', 'codex JSON retry attempts before repair', '2')
    .option('--codex-json-repair', 'enable codex JSON repair fallback', true)
    .option('--no-codex-json-repair', 'disable codex JSON repair fallback')
    .option('--codex-json-repair-retries <count>', 'codex JSON repair attempts after retries fail', '1')
    .option('--codex-timeout-ms <ms>', 'timeout for each local codex exec call', '180000')
    .option('--codex-context-mode <mode>', 'codex context mode: compact, balanced, or rich', 'compact')
    .option('--codex-context-budget-bytes <bytes>', 'maximum bytes of selected Codex prompt context')
    .option('--codex-max-artifacts-in-context <count>', 'maximum number of artifacts included in Codex context');
}

function addCodexBenchmarkOptions(command: Command): Command {
  return addCodexPilotOptions(command)
    .option('--level <level>', 'benchmark level: health, bible, plan, draft, preview, confirm, chapter2, chapter3, all', 'all')
    .option('--timeout-ms <ms>', 'alias for codex stage timeout', '180000')
    .option('--max-total-runtime-ms <ms>', 'alias for codex max total runtime')
    .option('--codex-stage-timeout-ms <ms>', 'timeout for each benchmark stage')
    .option('--codex-max-total-runtime-ms <ms>', 'maximum total benchmark runtime')
    .option('--codex-max-calls-per-stage <count>', 'maximum Codex calls per benchmark stage')
    .option('--continue-on-failure', 'continue subsequent levels after a failed level', false)
    .option('--resume', 'resume from existing preview or committed artifacts', false)
    .option('--compare-profiles <profiles>', 'comma-separated profiles to compare, e.g. clean,debug')
    .option('--optimization-mode <mode>', 'runtime optimization mode: low-risk-v1')
    .option('--codex-final-mode <mode>', 'codex final mode: codex, local-assemble, or light-polish', 'codex')
    .option('--use-cache', 'enable build-bible artifact cache during benchmark', false)
    .option('--warm-cache', 'run a second build-bible cache-hit stage after cold cache warmup', false)
    .option('--profile-stages', 'write codex_stage_runtime_profile_vN after the benchmark', false);
}

function baseOptions(options: CodexCommandOptions) {
  return {
    ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
    projectsRoot: options.root ?? './projects',
    projectId: options.projectId ?? 'codex-boundary'
  };
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
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

function parseBenchmarkLevel(value: string): 'health' | 'bible' | 'plan' | 'draft' | 'preview' | 'confirm' | 'chapter2' | 'chapter3' | 'all' {
  const allowed = ['health', 'bible', 'plan', 'draft', 'preview', 'confirm', 'chapter2', 'chapter3', 'all'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new AppError('INVALID_CODEX_BENCHMARK_LEVEL', `Invalid benchmark level: ${value}`, 2);
  }
  return value as (typeof allowed)[number];
}

function parseCodexProfile(value: string): 'default' | 'clean' | 'debug' {
  const allowed = ['default', 'clean', 'debug'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new AppError('INVALID_CODEX_PROFILE', `Invalid codex profile: ${value}`, 2);
  }
  return value as (typeof allowed)[number];
}

function parseCodexContextMode(value: string): 'compact' | 'balanced' | 'rich' {
  const allowed = ['compact', 'balanced', 'rich'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new AppError('INVALID_CODEX_CONTEXT_MODE', `Invalid codex context mode: ${value}`, 2);
  }
  return value as (typeof allowed)[number];
}

function parseCodexFinalMode(value: string): 'codex' | 'local-assemble' | 'light-polish' {
  const allowed = ['codex', 'local-assemble', 'light-polish'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new AppError('INVALID_CODEX_FINAL_MODE', `Invalid codex final mode: ${value}`, 2);
  }
  return value as (typeof allowed)[number];
}

function parseSamplingStage(value: string): 'chapter_mission' | 'scene_cards' | 'write_scene' | 'canon_patch_proposal' | 'diagnostics' | 'final_chapter' {
  const allowed = ['chapter_mission', 'scene_cards', 'write_scene', 'canon_patch_proposal', 'diagnostics', 'final_chapter'] as const;
  if (!allowed.includes(value as (typeof allowed)[number])) {
    throw new AppError('INVALID_CODEX_SAMPLING_STAGE', `Invalid sampling stage: ${value}`, 2);
  }
  return value as (typeof allowed)[number];
}

function parseOptimizationMode(value: string): 'low-risk-v1' {
  if (value !== 'low-risk-v1') {
    throw new AppError('INVALID_CODEX_OPTIMIZATION_MODE', `Invalid codex optimization mode: ${value}`, 2);
  }
  return value;
}

function parseProfiles(value: string): Array<'default' | 'clean' | 'debug'> {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(parseCodexProfile);
}

function parseChapterRange(value: string): number[] {
  const range = /^(\d+)-(\d+)$/.exec(value);
  if (range !== null) {
    const start = parsePositiveInteger(range[1]!, 'chapters');
    const end = parsePositiveInteger(range[2]!, 'chapters');
    if (end < start) {
      throw new AppError('INVALID_CHAPTER_RANGE', 'chapter range end must be greater than or equal to start', 2);
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return value.split(',').map((part) => parsePositiveInteger(part.trim(), 'chapters'));
}
