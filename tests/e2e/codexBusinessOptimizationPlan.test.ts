import { describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { generateCodexBusinessOptimizationPlan } from '../../src/app/codexBusinessOptimizationPlan.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexBusinessOptimizationPlanSchema, CodexStageRuntimeProfileReportSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { briefPath, createTempRoot, fixturesRoot, promptRoot, removeTempRoot } from './m16Helpers.js';

describe('M27.4 Codex business optimization candidates', () => {
  test('generates a read-only business optimization plan from the latest runtime profile', async () => {
    const tempRoot = await createTempRoot('novel-loop-m274-business-plan-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-business-plan');
      await writeSyntheticRuntimeProfile(paths, store);
      const storyStateBefore = await store.readText(paths.storyState());

      const result = await generateCodexBusinessOptimizationPlan({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      const report = result.report;

      expect(report).toMatchObject({
        reportId: 'codex_business_optimization_plan_v1',
        projectId: paths.projectId,
        sourceProfilePath: 'audit/codex_stage_runtime_profile_v1.json',
        sourceProfileVersion: 1,
        businessTotalDurationMs: 1_500_000,
        rawTotalDurationMs: 2_200_000,
        wrapperDurationMs: 600_000,
        storyStateMutated: false
      });
      expect(CodexBusinessOptimizationPlanSchema.parse(report)).toMatchObject({ reportId: report.reportId });
      expect(report.wrapperInterpretation).toMatchObject({
        likelyIncludesProviderExecution: true,
        pureBoundaryOverheadEstimateMs: null,
        reason: 'Current event timing does not separate provider execution from boundary process duration.',
        childCallsRolledUpToBusiness: true,
        orphanWrapperDurationMs: 80_000
      });
      expect(report.targetStages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: 'canon_patch_proposal', promptId: 'production.extract_canon_patch', safetyCritical: true }),
          expect.objectContaining({ stage: 'build_bible', promptId: 'strategy.build_bible', safetyCritical: false }),
          expect.objectContaining({ stage: 'write_scene', promptId: 'production.write_scene', recommendedStrategy: expect.stringContaining('chapter summary') }),
          expect.objectContaining({ stage: 'final_chapter', promptId: 'production.final_chapter' })
        ])
      );
      expect(report.optimizationCandidates[0]).toMatchObject({
        riskLevel: 'low',
        safetyImpact: 'read_only'
      });
      expect(report.optimizationCandidates.map((candidate) => candidate.candidateId)).toEqual(report.recommendedExecutionOrder);
      expect(report.optimizationCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: 'canon_patch_proposal', candidateType: 'slim_schema', safetyImpact: 'safety_critical' }),
          expect.objectContaining({ stage: 'write_scene', candidateType: 'add_context_budget' }),
          expect.objectContaining({ stage: 'final_chapter', candidateType: 'localize_task' }),
          expect.objectContaining({ stage: 'planning.validate_and_assemble', candidateType: 'improve_stage_mapping' }),
          expect.objectContaining({ promptId: 'codex.exec-json', candidateType: 'classify_orphan_wrapper' })
        ])
      );
      expect(report.stageSpecificAnalysis).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: 'canon_patch_proposal', recommendation: expect.stringContaining('split extraction') }),
          expect.objectContaining({ stage: 'final_chapter', recommendation: expect.stringContaining('local assemble') })
        ])
      );
      expect(report.safetyNotes.join('\n')).toContain('CanonPatchSchema validation');
      expect(report.safetyNotes.join('\n')).toContain('before/after snapshots');
      expect(report.safetyNotes.join('\n')).toContain('audit provenance');
      expect(report.orphanCleanupPlan).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ promptId: 'codex.exec-json', recommendedAction: expect.stringContaining('smoke-like') }),
          expect.objectContaining({ promptId: 'planning.validate_and_assemble', recommendedAction: expect.stringContaining('local planning assembly') })
        ])
      );

      const markdown = await store.readText(paths.projectArtifact(result.markdownPath));
      for (const heading of [
        'Executive Summary',
        'Current Runtime Breakdown',
        'Top Business Bottlenecks',
        'Top Optimization Candidates',
        'Stage-specific Recommendations',
        'Safety Constraints',
        'Recommended Next Milestones',
        'Do Not Optimize Away'
      ]) {
        expect(markdown).toContain(heading);
      }
      expect(markdown).toContain('CanonPatchSchema validation');
      expect(await store.readJson(paths.projectArtifact(result.reportPath), CodexBusinessOptimizationPlanSchema)).toMatchObject({
        reportId: 'codex_business_optimization_plan_v1'
      });
      expect(await store.readText(paths.storyState())).toBe(storyStateBefore);
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);

  test('audit validates optimization plans and warns about unresolved source profile attribution', async () => {
    const tempRoot = await createTempRoot('novel-loop-m274-business-audit-');
    try {
      const { paths, store } = await prepareProject(tempRoot, 'codex-business-audit');
      await writeSyntheticRuntimeProfile(paths, store);

      const result = await generateCodexBusinessOptimizationPlan({ projectId: paths.projectId, projectsRoot: tempRoot }, store);
      const audit = await auditProject({ projectId: paths.projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);

      expect(audit.ok).toBe(true);
      expect(audit.exitCode).toBe(0);
      expect(audit.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'warning',
            category: 'codex_optimization',
            path: result.reportPath
          })
        ])
      );
    } finally {
      await removeTempRoot(tempRoot);
    }
  }, 30_000);
});

async function prepareProject(tempRoot: string, projectId: string): Promise<{ paths: ProjectPaths; store: FileStore }> {
  const store = new FileStore();
  await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
  await buildBible({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_build_bible` }, store);
  await planGlobal({ projectId, projectsRoot: tempRoot, provider: 'mock', promptRoot, fixturesRoot, runId: `${projectId}_plan_global` }, store);
  return { paths: new ProjectPaths(tempRoot, projectId), store };
}

async function writeSyntheticRuntimeProfile(paths: ProjectPaths, store: FileStore): Promise<void> {
  await store.ensureDir(paths.auditDir());
  const businessCalls = [
    businessCall('canon_patch_call', 'production.extract_canon_patch', 'canon_patch_proposal', 500_000, {
      chapterNumber: 3,
      promptInputBytes: 72_000,
      schemaBytes: 35_000,
      outputBytes: 15_000,
      retryCount: 1,
      repairCount: 1
    }),
    businessCall('bible_call', 'strategy.build_bible', 'build_bible', 400_000, {
      promptInputBytes: 82_000,
      schemaBytes: 2_000,
      outputBytes: 25_000
    }),
    businessCall('write_scene_call', 'production.write_scene', 'write_scene', 320_000, {
      chapterNumber: 3,
      promptInputBytes: 96_000,
      schemaBytes: 8_000,
      outputBytes: 42_000
    }),
    businessCall('final_call', 'production.final_chapter', 'final_chapter', 200_000, {
      chapterNumber: 3,
      promptInputBytes: 45_000,
      schemaBytes: 1_000,
      outputBytes: 50_000
    }),
    businessCall('planning_assemble_call', 'planning.validate_and_assemble', 'planning.validate_and_assemble', 80_000, {
      promptInputBytes: 12_000,
      schemaBytes: 0,
      outputBytes: 1_000
    })
  ];
  const promptCalls = [
    promptCall('canon_patch_call', 'production.extract_canon_patch', 'canon_patch_proposal', 500_000, {
      chapterNumber: 3,
      promptInputBytes: 72_000,
      schemaBytes: 35_000,
      outputBytes: 15_000,
      retryCount: 1,
      repairCount: 1
    }),
    promptCall('bible_call', 'strategy.build_bible', 'build_bible', 400_000, {
      promptInputBytes: 82_000,
      schemaBytes: 2_000,
      outputBytes: 25_000
    }),
    promptCall('write_scene_call', 'production.write_scene', 'write_scene', 320_000, {
      chapterNumber: 3,
      promptInputBytes: 96_000,
      schemaBytes: 8_000,
      outputBytes: 42_000
    }),
    promptCall('final_call', 'production.final_chapter', 'final_chapter', 200_000, {
      chapterNumber: 3,
      promptInputBytes: 45_000,
      schemaBytes: 1_000,
      outputBytes: 50_000
    }),
    promptCall('planning_assemble_call', 'planning.validate_and_assemble', 'planning.validate_and_assemble', 80_000, {
      classified: false,
      likelyCategory: 'unknown',
      promptInputBytes: 12_000,
      outputBytes: 1_000
    }),
    promptCall('orphan_exec_json', 'codex.exec-json', 'other_codex', 80_000, {
      classified: false,
      provider: 'codex-cli',
      likelyCategory: 'unknown',
      wrapperCallType: 'exec_json',
      attributionMode: 'unclassified',
      attributionConfidence: 'low',
      attributionReason: 'orphan wrapper fixture',
      rawOutputPath: 'codex/runs/orphan/raw.jsonl',
      finalOutputPath: 'codex/runs/orphan/final.json',
      parsedOutputPath: 'codex/runs/orphan/parsed.json',
      promptInputBytes: 5_000,
      outputBytes: 700
    })
  ];
  const durationByStage = {
    canon_patch_proposal: 500_000,
    build_bible: 400_000,
    write_scene: 320_000,
    final_chapter: 200_000,
    'planning.validate_and_assemble': 80_000,
    other_codex: 80_000
  };
  await store.writeJson(
    paths.auditArtifact('codex_stage_runtime_profile_v1.json'),
    {
      reportId: 'codex_stage_runtime_profile_v1',
      projectId: paths.projectId,
      generatedAt: '2026-07-07T00:00:00.000Z',
      sourceRunCount: 6,
      sourceBenchmarkReportPaths: [],
      totalDurationMs: 2_200_000,
      durationByChapter: { chapter_3: 1_020_000 },
      durationByStage,
      codexCallsByStage: {
        canon_patch_proposal: 1,
        build_bible: 1,
        write_scene: 1,
        final_chapter: 1,
        'planning.validate_and_assemble': 1,
        other_codex: 1
      },
      retriesByStage: { canon_patch_proposal: 1 },
      repairsByStage: { canon_patch_proposal: 1 },
      timeoutByStage: {},
      promptBytesByStage: {
        canon_patch_proposal: 72_000,
        build_bible: 82_000,
        write_scene: 96_000,
        final_chapter: 45_000,
        'planning.validate_and_assemble': 12_000,
        other_codex: 5_000
      },
      outputBytesByStage: {
        canon_patch_proposal: 15_000,
        build_bible: 25_000,
        write_scene: 42_000,
        final_chapter: 50_000,
        'planning.validate_and_assemble': 1_000,
        other_codex: 700
      },
      schemaBytesByStage: {
        canon_patch_proposal: 35_000,
        build_bible: 2_000,
        write_scene: 8_000,
        final_chapter: 1_000
      },
      profiledPromptCallCount: promptCalls.length,
      slowestPromptCalls: promptCalls,
      promptCallsByPromptId: {
        'production.extract_canon_patch': 1,
        'strategy.build_bible': 1,
        'production.write_scene': 1,
        'production.final_chapter': 1,
        'planning.validate_and_assemble': 1,
        'codex.exec-json': 1
      },
      promptCallsByStage: {
        canon_patch_proposal: 1,
        build_bible: 1,
        write_scene: 1,
        final_chapter: 1,
        'planning.validate_and_assemble': 1,
        other_codex: 1
      },
      promptCallsByRun: {
        run_canon: 1,
        run_bible: 1,
        run_write: 1,
        run_final: 1,
        run_planning: 1,
        run_orphan: 1
      },
      promptCallsByChapter: { chapter_3: 3 },
      largestPromptInputs: [promptCalls[2]!, promptCalls[1]!, promptCalls[0]!],
      largestSchemas: [promptCalls[0]!],
      largestOutputs: [promptCalls[3]!, promptCalls[2]!],
      repairCalls: [promptCalls[0]!],
      retryCalls: [promptCalls[0]!],
      unclassifiedCalls: [promptCalls[4]!, promptCalls[5]!],
      remainingUnclassifiedCount: 2,
      otherCodexBreakdown: {
        totalCalls: 2,
        totalDurationMs: 160_000,
        byPromptId: [
          { key: 'planning.validate_and_assemble', totalCalls: 1, totalDurationMs: 80_000 },
          { key: 'codex.exec-json', totalCalls: 1, totalDurationMs: 80_000 }
        ],
        byRunId: [
          { key: 'run_planning', totalCalls: 1, totalDurationMs: 80_000 },
          { key: 'run_orphan', totalCalls: 1, totalDurationMs: 80_000 }
        ],
        byCommand: [{ key: 'codex', totalCalls: 2, totalDurationMs: 160_000 }],
        byArtifactType: [{ key: 'prompt_artifact', totalCalls: 2, totalDurationMs: 160_000 }],
        likelyCategories: [{ category: 'unknown', totalCalls: 2, totalDurationMs: 160_000 }],
        reasonCategories: [
          { category: 'true_unknown', totalCalls: 1, totalDurationMs: 80_000 },
          { category: 'wrapper_orphan', totalCalls: 1, totalDurationMs: 80_000 }
        ]
      },
      rawRuntimeView: {
        totalPromptCallCount: promptCalls.length,
        totalDurationMs: 2_200_000,
        byStage: durationByStage,
        includesWrapperCalls: true
      },
      businessRuntimeView: {
        totalBusinessCallCount: businessCalls.length,
        totalDurationMs: 1_500_000,
        byBusinessStage: {
          canon_patch_proposal: 500_000,
          build_bible: 400_000,
          write_scene: 320_000,
          final_chapter: 200_000,
          'planning.validate_and_assemble': 80_000
        },
        byPromptId: {
          'production.extract_canon_patch': 500_000,
          'strategy.build_bible': 400_000,
          'production.write_scene': 320_000,
          'production.final_chapter': 200_000,
          'planning.validate_and_assemble': 80_000
        },
        wrapperCallsRolledUp: true,
        doubleCountingRemoved: true
      },
      overheadRuntimeView: {
        wrapperCallCount: 1,
        wrapperDurationMs: 600_000,
        healthSmokeDurationMs: 0,
        jsonRepairDurationMs: 30_000,
        redactionDurationMs: 0,
        artifactWriteDurationMs: 0,
        unclassifiedOverheadMs: 80_000
      },
      wrapperBreakdown: {
        totalWrapperCalls: 1,
        totalWrapperDurationMs: 600_000,
        orphanWrapperCallCount: 1,
        byWrapperType: [{ key: 'exec_json', totalCalls: 1, totalDurationMs: 80_000 }],
        byParentStage: [],
        byParentPromptId: [],
        orphanWrapperCalls: [
          {
            promptCallId: 'orphan_exec_json',
            wrapperCallType: 'exec_json',
            runId: 'run_orphan',
            durationMs: 80_000,
            attributionMode: 'unclassified',
            attributionConfidence: 'low',
            attributionReason: 'orphan wrapper fixture',
            rawOutputPath: 'codex/runs/orphan/raw.jsonl',
            finalOutputPath: 'codex/runs/orphan/final.json',
            parsedOutputPath: 'codex/runs/orphan/parsed.json'
          }
        ],
        inferredWrapperCalls: []
      },
      slowestBusinessPromptCalls: businessCalls,
      slowestRuns: [],
      durationByCommand: { 'chapter --provider codex-text': 1_020_000, codex: 80_000 },
      durationByPromptId: {
        'production.extract_canon_patch': 500_000,
        'strategy.build_bible': 400_000,
        'production.write_scene': 320_000,
        'production.final_chapter': 200_000,
        'planning.validate_and_assemble': 80_000,
        'codex.exec-json': 80_000
      },
      durationByPromptFamily: { production: 1_020_000, strategy: 400_000, planning: 80_000, codex: 80_000 },
      durationByChapterStage: { 'chapter_3.canon_patch_proposal': 500_000, 'chapter_3.write_scene': 320_000, 'chapter_3.final_chapter': 200_000 },
      slowestStages: [
        { stage: 'canon_patch_proposal', durationMs: 500_000, codexCallCount: 1 },
        { stage: 'build_bible', durationMs: 400_000, codexCallCount: 1 },
        { stage: 'write_scene', durationMs: 320_000, codexCallCount: 1 }
      ],
      optimizationCandidates: [],
      storyStateMutated: false
    },
    CodexStageRuntimeProfileReportSchema
  );
  await store.writeText(paths.auditArtifact('codex_stage_runtime_profile_v1.md'), '# Runtime Profile\n');
}

function promptCall(
  promptCallId: string,
  promptId: string,
  inferredStage: string,
  durationMs: number,
  options: {
    chapterNumber?: number;
    classified?: boolean;
    provider?: 'codex-text' | 'codex-cli';
    likelyCategory?: string;
    promptInputBytes?: number;
    contextBytes?: number;
    schemaBytes?: number;
    outputBytes?: number;
    retryCount?: number;
    repairCount?: number;
    rawOutputPath?: string;
    finalOutputPath?: string;
    parsedOutputPath?: string;
    wrapperCallType?: 'exec_text' | 'exec_json' | 'health' | 'smoke' | 'repair' | 'unknown';
    attributionMode?: 'direct' | 'parent_child' | 'inferred' | 'unclassified';
    attributionConfidence?: 'high' | 'medium' | 'low';
    attributionReason?: string;
  }
) {
  const promptFamily = promptId.split('.')[0] ?? 'unknown';
  return {
    promptCallId,
    runId: `run_${promptCallId.split('_')[0] ?? 'fixture'}`,
    command: options.provider === 'codex-cli' ? 'codex' : 'chapter --provider codex-text',
    status: 'succeeded',
    ...(options.chapterNumber === undefined ? {} : { chapterNumber: options.chapterNumber }),
    promptId,
    promptFamily,
    inferredStage,
    likelyCategory: options.likelyCategory ?? 'business',
    classified: options.classified ?? true,
    durationMs,
    latencyMs: durationMs,
    promptInputBytes: options.promptInputBytes ?? 1_000,
    contextBytes: options.contextBytes ?? options.promptInputBytes ?? 1_000,
    schemaBytes: options.schemaBytes ?? 0,
    outputBytes: options.outputBytes ?? 500,
    rawJsonlBytes: options.rawOutputPath === undefined ? 0 : options.outputBytes ?? 500,
    retryCount: options.retryCount ?? 0,
    repairCount: options.repairCount ?? 0,
    jsonParsed: (options.schemaBytes ?? 0) > 0,
    schemaValid: (options.schemaBytes ?? 0) > 0,
    artifactPaths: [],
    suggestedOptimization: 'fixture optimization hint',
    ...options
  };
}

function businessCall(
  businessPromptCallId: string,
  promptId: string,
  stage: string,
  netDurationMs: number,
  options: {
    chapterNumber?: number;
    promptInputBytes?: number;
    contextBytes?: number;
    schemaBytes?: number;
    outputBytes?: number;
    retryCount?: number;
    repairCount?: number;
  }
) {
  return {
    businessPromptCallId,
    promptId,
    stage,
    ...(options.chapterNumber === undefined ? {} : { chapterNumber: options.chapterNumber }),
    runId: `run_${businessPromptCallId.split('_')[0] ?? 'fixture'}`,
    netDurationMs,
    wrapperDurationMs: 0,
    providerLatencyMs: netDurationMs,
    promptInputBytes: options.promptInputBytes ?? 1_000,
    contextBytes: options.contextBytes ?? options.promptInputBytes ?? 1_000,
    schemaBytes: options.schemaBytes ?? 0,
    outputBytes: options.outputBytes ?? 500,
    retryCount: options.retryCount ?? 0,
    repairCount: options.repairCount ?? 0,
    childWrapperCallIds: [],
    suggestedOptimization: 'fixture business optimization hint'
  };
}
