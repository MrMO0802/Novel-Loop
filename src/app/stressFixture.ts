import path from 'node:path';

import {
  CanonPatchSchema,
  ChapterMissionSchema,
  ChapterQueueSchema,
  CommitReportSchema,
  ConfigSchema,
  RunEventSchema,
  RunManifestV2Schema,
  SnapshotSchema,
  StoryStateSchema
} from '../schemas/index.js';
import type { RunEvent, RunManifestV2, SnapshotMeta, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { readFileMetadata } from './fileHash.js';

export interface StressFixtureInput {
  projectId: string;
  projectsRoot?: string;
  chapters: number;
  runsPerChapter?: number;
  extraEventsPerRun?: number;
}

export interface StressFixtureResult {
  projectId: string;
  chapterCount: number;
  runCount: number;
  snapshotCount: number;
  paths: ProjectPaths;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function createStressFixture(input: StressFixtureInput, fileStore = new FileStore()): Promise<StressFixtureResult> {
  const chapters = assertChapterCount(input.chapters);
  const runsPerChapter = input.runsPerChapter ?? 2;
  const extraEventsPerRun = input.extraEventsPerRun ?? 0;
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const now = new Date().toISOString();

  await createProjectDirs(paths, fileStore);
  await fileStore.writeText(paths.brief(), '# Stress Fixture\n\nDeterministic long-project fixture for release hardening.\n');
  await fileStore.writeJson(
    paths.config(),
    {
      projectId: paths.projectId,
      language: 'zh-CN',
      defaultProvider: 'mock',
      qualityThreshold: 8.2,
      chapter: {
        defaultCandidateCount: 3,
        maxRevisionAttempts: 2,
        targetWordCount: 1200,
        sceneMinCount: 2,
        sceneMaxCount: 4
      }
    },
    ConfigSchema
  );
  await writeStrategyAndPlanning(paths, fileStore, chapters);

  let runCount = 0;
  let snapshotCount = 0;
  for (let chapterNumber = 1; chapterNumber <= chapters; chapterNumber += 1) {
    await writeChapterArtifacts(paths, fileStore, chapterNumber, now);
    const before = stateForChapter(paths.projectId, chapterNumber - 1, now);
    const after = stateForChapter(paths.projectId, chapterNumber, now);
    const beforeMeta = await writeSnapshot(paths, fileStore, chapterNumber, 'before', before, `stress_ch${pad(chapterNumber)}_commit`, now);
    const afterMeta = await writeSnapshot(paths, fileStore, chapterNumber, 'after', after, `stress_ch${pad(chapterNumber)}_commit`, now);
    snapshotCount += 2;
    await writeCommitPatchAndReport(paths, fileStore, chapterNumber, beforeMeta, afterMeta, now);
    await writeRun(paths, fileStore, chapterNumber, 'planning', extraEventsPerRun);
    runCount += 1;
    if (runsPerChapter >= 2) {
      await writeRun(paths, fileStore, chapterNumber, 'commit', extraEventsPerRun);
      runCount += 1;
    }
  }

  await fileStore.writeJson(paths.storyState(), stateForChapter(paths.projectId, chapters, now), StoryStateSchema);
  await fileStore.writeJson(paths.chapterQueue(), buildQueue(paths.projectId, chapters, now), ChapterQueueSchema);

  return {
    projectId: paths.projectId,
    chapterCount: chapters,
    runCount,
    snapshotCount,
    paths
  };
}

function assertChapterCount(chapters: number): number {
  if (!Number.isInteger(chapters) || chapters < 1 || chapters > 50) {
    throw new Error('stress fixture chapter count must be between 1 and 50');
  }
  return chapters;
}

async function createProjectDirs(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  for (const dir of [
    paths.projectRoot,
    paths.strategyDir(),
    paths.stateDir(),
    paths.planningDir(),
    paths.chaptersDir(),
    paths.runsDir(),
    paths.snapshotsDir(),
    paths.diffsDir(),
    paths.auditDir(),
    paths.artifactsDir()
  ]) {
    await fileStore.ensureDir(dir);
  }
}

async function writeStrategyAndPlanning(paths: ProjectPaths, fileStore: FileStore, chapters: number): Promise<void> {
  await fileStore.writeText(path.join(paths.strategyDir(), 'story_bible.md'), '# Stress Story Bible\n');
  await fileStore.writeText(path.join(paths.strategyDir(), 'genre_contract.md'), '# Stress Genre Contract\n');
  await fileStore.writeText(path.join(paths.strategyDir(), 'reader_promise.md'), '# Stress Reader Promise\n');
  await fileStore.writeText(path.join(paths.strategyDir(), 'style_guide.md'), '# Stress Style Guide\n');
  await fileStore.writeText(path.join(paths.planningDir(), 'global_outline.md'), '# Stress Global Outline\n');
  await fileStore.writeText(path.join(paths.planningDir(), 'volume_01_outline.md'), '# Stress Volume Outline\n');
  await fileStore.writeJson(
    path.join(paths.planningDir(), 'arc_map.json'),
    {
      schemaVersion: '1.0',
      projectId: paths.projectId,
      arcs: [
        {
          id: 'arc_stress_main',
          name: 'Stress Main Arc',
          type: 'plot',
          summary: `Deterministic ${chapters} chapter stress arc.`,
          startChapter: 1,
          targetEndChapter: chapters
        }
      ]
    },
    (await import('../schemas/index.js')).ArcMapSchema
  );
}

async function writeChapterArtifacts(paths: ProjectPaths, fileStore: FileStore, chapterNumber: number, now: string): Promise<void> {
  await fileStore.ensureDir(paths.chapterArtifact(chapterNumber, 'plan_candidates'));
  await fileStore.ensureDir(paths.chapterArtifact(chapterNumber, 'scenes'));
  await fileStore.writeJson(
    paths.chapterArtifact(chapterNumber, 'mission.json'),
    {
      id: `mission_ch${pad(chapterNumber)}`,
      chapterNumber,
      chapterFunction: `Stress chapter ${chapterNumber} advances the deterministic thread.`,
      requiredObjectives: [
        {
          id: `obj_ch${pad(chapterNumber)}`,
          text: `Advance stress chapter ${chapterNumber}.`,
          type: 'plot',
          priority: 'must'
        }
      ],
      readerInformationDelta: {
        newKnowledge: [`Stress chapter ${chapterNumber} fact`],
        newSuspicions: [],
        questionsToMaintain: [],
        questionsToAnswer: []
      },
      targetWordCount: 1200
    },
    ChapterMissionSchema
  );
  for (const candidate of [1, 2, 3]) {
    await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'plan_candidates', `plan_${pad(candidate)}.md`), `# Plan ${candidate}\n\nStress chapter ${chapterNumber} candidate ${candidate}.\n`);
  }
  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'selected_plan.md'), `# Selected Plan\n\nStress chapter ${chapterNumber} selected plan.\n`);
  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'final.md'), `# Chapter ${chapterNumber}\n\nStress fixture final chapter ${chapterNumber}.\n`);
  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'draft_v1.md'), `# Chapter ${chapterNumber}\n\nStress fixture draft chapter ${chapterNumber}.\n`);
  await fileStore.writeText(paths.chapterArtifact(chapterNumber, 'scenes', 'scene_001.md'), `Stress scene for chapter ${chapterNumber}.\n`);
  void now;
}

async function writeCommitPatchAndReport(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  beforeSnapshot: SnapshotMeta,
  afterSnapshot: SnapshotMeta,
  now: string
): Promise<void> {
  const fact = factForChapter(chapterNumber, now);
  const timelineEvent = timelineForChapter(chapterNumber);
  await fileStore.writeJson(
    paths.chapterArtifact(chapterNumber, 'canon_patch.json'),
    {
      chapterNumber,
      sourceFinalPath: path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, 'final.md'),
      latestCommittedChapter: chapterNumber,
      newFacts: [fact],
      timelineEvents: [timelineEvent],
      readerStatePatch: {
        addKnows: [fact.text],
        addSuspects: [],
        addQuestions: [],
        removeQuestions: [],
        addExpectations: [`Continue stress chapter ${chapterNumber + 1}`],
        addDoesNotKnow: []
      }
    },
    CanonPatchSchema
  );
  await fileStore.writeJson(
    paths.chapterArtifact(chapterNumber, 'commit_report.json'),
    {
      chapterNumber,
      status: 'committed',
      canonPatchPath: path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, 'canon_patch.json'),
      storyStatePath: 'state/story_state.json',
      beforeSnapshot,
      afterSnapshot,
      conflicts: { hard: [], warnings: [] },
      repaired: false,
      appliedChanges: {
        canonFactsAdded: 1,
        characterStatesUpserted: 0,
        characterUpdatesApplied: 0,
        timelineEventsAdded: 1,
        readerStateChanges: 2,
        narrativeDebtsChanged: 0,
        foreshadowingChanged: 0,
        relationshipEdgesChanged: 0,
        latestCommittedChapter: {
          from: chapterNumber - 1,
          to: chapterNumber
        }
      },
      committedAt: now
    },
    CommitReportSchema
  );
}

async function writeSnapshot(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  kind: 'before' | 'after',
  storyState: StoryState,
  runId: string,
  now: string
): Promise<SnapshotMeta> {
  const snapshotId = `stress_ch${pad(chapterNumber)}_${kind}`;
  const meta: SnapshotMeta = {
    snapshotId,
    path: path.posix.join('snapshots', `${snapshotId}.json`),
    createdAt: now,
    reason: `${kind}_chapter_${chapterNumber}_stress_commit`,
    sourceChapter: chapterNumber,
    runId
  };
  await fileStore.writeJson(paths.snapshot(snapshotId), { meta, storyState }, SnapshotSchema);
  return meta;
}

async function writeRun(
  paths: ProjectPaths,
  fileStore: FileStore,
  chapterNumber: number,
  kind: 'planning' | 'commit',
  extraEventsPerRun: number
): Promise<void> {
  const runId = `stress_ch${pad(chapterNumber)}_${kind}`;
  const startedAt = new Date(Date.UTC(2026, 0, 1, 0, chapterNumber, kind === 'planning' ? 0 : 1)).toISOString();
  const endedAt = new Date(Date.parse(startedAt) + 10).toISOString();
  const artifactPaths =
    kind === 'planning'
      ? [relativeChapterArtifact(chapterNumber, 'mission.json'), relativeChapterArtifact(chapterNumber, 'selected_plan.md')]
      : [
          relativeChapterArtifact(chapterNumber, 'final.md'),
          relativeChapterArtifact(chapterNumber, 'canon_patch.json'),
          relativeChapterArtifact(chapterNumber, 'commit_report.json'),
          path.posix.join('snapshots', `stress_ch${pad(chapterNumber)}_before.json`),
          path.posix.join('snapshots', `stress_ch${pad(chapterNumber)}_after.json`)
        ];
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const metadata = await readFileMetadata(paths.projectArtifact(artifactPath), fileStore);
    artifacts.push({
      artifactId: `artifact_${runId}_${artifacts.length + 1}`,
      artifactType: artifactTypeFor(artifactPath),
      path: artifactPath,
      chapterNumber,
      phase: kind === 'planning' ? 'chapter_planning' : artifactPath.startsWith('snapshots/') ? 'snapshot' : 'commit',
      action: 'generated',
      runId,
      stage: kind,
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes,
      sourceArtifactIds: [],
      sourcePaths: [],
      derivedFrom: [],
      status: 'active',
      provenanceNote: `stress fixture ${kind}`
    });
  }
  const manifest: RunManifestV2 = RunManifestV2Schema.parse({
    schemaVersion: '2',
    runId,
    projectId: paths.projectId,
    command: 'stress-fixture',
    args: { chapterNumber, kind },
    argv: ['stress-fixture', paths.projectId, String(chapterNumber)],
    cwd: process.cwd(),
    startedAt,
    endedAt,
    durationMs: 10,
    status: 'success',
    packageVersion: '0.1.0',
    nodeVersion: process.version,
    provider: 'mock',
    redactionPolicy: {
      savePromptInputs: false,
      savePromptOutputs: false,
      redactSecrets: true,
      redactUserContent: false,
      redactedFields: []
    },
    resolvedContext: {
      projectId: paths.projectId,
      chapterNumber,
      requestedChapter: chapterNumber,
      resolvedChapterNumber: chapterNumber,
      mode: kind === 'planning' ? 'dry_run' : 'commit',
      latestCommittedChapterBefore: Math.max(0, chapterNumber - 1),
      latestCommittedChapterAfter: kind === 'commit' ? chapterNumber : Math.max(0, chapterNumber - 1),
      queueStatusBefore: 'planned',
      queueStatusAfter: kind === 'commit' ? 'committed' : 'planned_ready'
    },
    stages: [
      {
        stage: kind,
        name: kind,
        status: 'completed',
        startedAt,
        endedAt,
        durationMs: 10,
        chapterNumber
      }
    ],
    artifacts,
    snapshots:
      kind === 'commit'
        ? [
            {
              snapshotId: `stress_ch${pad(chapterNumber)}_before`,
              path: path.posix.join('snapshots', `stress_ch${pad(chapterNumber)}_before.json`),
              reason: `before_chapter_${chapterNumber}_stress_commit`,
              chapterNumber
            },
            {
              snapshotId: `stress_ch${pad(chapterNumber)}_after`,
              path: path.posix.join('snapshots', `stress_ch${pad(chapterNumber)}_after.json`),
              reason: `after_chapter_${chapterNumber}_stress_commit`,
              chapterNumber
            }
          ]
        : [],
    queueTransitions: [],
    stateMutations: [],
    promptCalls: [],
    llmCalls: [],
    archives: [],
    conflicts: [],
    repairs: [],
    recommits: [],
    historicalRebases: [],
    reusePolicies: [],
    errors: [],
    auditRefs: [],
    summary: {
      generatedArtifactCount: artifacts.length,
      reusedArtifactCount: 0,
      archivedArtifactCount: 0,
      promptCallCount: 0,
      queueTransitionCount: 0,
      stateMutationCount: 0,
      snapshotCount: kind === 'commit' ? 2 : 0,
      errorCount: 0
    }
  });
  await fileStore.ensureDir(paths.runDir(runId));
  await fileStore.writeJson(paths.runManifest(runId), manifest, RunManifestV2Schema);
  await fileStore.writeText(paths.runEvents(runId), eventsForRun(paths.projectId, runId, chapterNumber, kind, artifactPaths, startedAt, endedAt, extraEventsPerRun));
}

function eventsForRun(
  projectId: string,
  runId: string,
  chapterNumber: number,
  kind: 'planning' | 'commit',
  artifactPaths: string[],
  startedAt: string,
  endedAt: string,
  extraEventsPerRun: number
): string {
  const events: RunEvent[] = [
    event(projectId, runId, 'RUN_STARTED', startedAt, chapterNumber, kind, { kind }, 'run_started'),
    event(projectId, runId, 'STAGE_STARTED', startedAt, chapterNumber, kind, { stage: kind }, 'stage_started'),
    ...Array.from({ length: extraEventsPerRun }, (_, index) =>
      event(projectId, runId, 'ARTIFACT_VALIDATED', startedAt, chapterNumber, kind, { index }, `extra_${index + 1}`)
    ),
    ...artifactPaths.map((artifactPath, index) =>
      event(projectId, runId, 'ARTIFACT_GENERATED', startedAt, chapterNumber, kind, { artifactPath, index }, `artifact_${index + 1}`, [artifactPath])
    ),
    event(projectId, runId, 'STAGE_COMPLETED', endedAt, chapterNumber, kind, { stage: kind }, 'stage_completed'),
    event(projectId, runId, 'RUN_COMPLETED', endedAt, chapterNumber, kind, { status: 'success' }, 'run_completed')
  ];
  return events.map((item) => `${JSON.stringify(item)}`).join('\n') + '\n';
}

function event(
  projectId: string,
  runId: string,
  eventType: RunEvent['eventType'],
  timestamp: string,
  chapterNumber: number,
  stage: string,
  payload: Record<string, unknown>,
  eventKey: string,
  relatedArtifactPaths: string[] = []
): RunEvent {
  return RunEventSchema.parse({
    eventId: `${runId}_${eventKey}`,
    runId,
    projectId,
    timestamp,
    eventType,
    chapterNumber,
    stage,
    payload,
    relatedArtifactPaths,
    severity: 'info'
  });
}

function stateForChapter(projectId: string, latestCommittedChapter: number, now: string): StoryState {
  return StoryStateSchema.parse({
    schemaVersion: '1.0',
    projectId,
    language: 'zh-CN',
    latestCommittedChapter,
    canonFacts: Array.from({ length: latestCommittedChapter }, (_, index) => factForChapter(index + 1, now)),
    characters: [
      {
        id: 'char_stress_protagonist',
        name: 'Stress Protagonist',
        role: 'protagonist',
        publicDescription: 'A deterministic stress fixture protagonist.',
        currentGoal: `Reach chapter ${latestCommittedChapter}`,
        emotionalState: 'focused',
        arc: {},
        lastUpdatedChapter: latestCommittedChapter
      }
    ],
    worldRules: [],
    timeline: Array.from({ length: latestCommittedChapter }, (_, index) => timelineForChapter(index + 1)),
    plotThreads: [
      {
        id: 'thread_stress_main',
        name: 'Stress Main Thread',
        status: latestCommittedChapter > 0 ? 'active' : 'paused',
        summary: `Stress thread through chapter ${latestCommittedChapter}.`
      }
    ],
    narrativeDebts: [],
    foreshadowing: [],
    readerState: {
      readerKnows: Array.from({ length: latestCommittedChapter }, (_, index) => `Stress fact ${index + 1}`),
      readerSuspects: [],
      readerQuestions: [],
      readerExpectations: latestCommittedChapter === 0 ? ['Begin stress story'] : [`Continue to chapter ${latestCommittedChapter + 1}`],
      readerDoesNotKnow: []
    },
    relationshipGraph: {
      nodes: [{ characterId: 'char_stress_protagonist', label: 'Stress Protagonist' }],
      edges: []
    },
    revealSchedule: [],
    updatedAt: now
  });
}

function factForChapter(chapterNumber: number, now: string) {
  return {
    id: `fact_stress_ch${pad(chapterNumber)}`,
    text: `Stress fact ${chapterNumber}`,
    sourceChapter: chapterNumber,
    type: 'event',
    visibility: {
      reader: true,
      author: true,
      characters: {
        char_stress_protagonist: true
      }
    },
    confidence: 'explicit',
    createdAt: now
  };
}

function timelineForChapter(chapterNumber: number) {
  return {
    id: `event_stress_ch${pad(chapterNumber)}`,
    chapter: chapterNumber,
    order: chapterNumber,
    summary: `Stress chapter ${chapterNumber} event.`,
    participants: ['char_stress_protagonist'],
    location: 'stress_fixture'
  };
}

function buildQueue(projectId: string, chapters: number, now: string) {
  return ChapterQueueSchema.parse({
    schemaVersion: '1.0',
    projectId,
    chapters: [
      ...Array.from({ length: chapters }, (_, index) => {
        const chapterNumber = index + 1;
        return {
          chapterNumber,
          title: `Stress Chapter ${chapterNumber}`,
          status: 'committed',
          latestRunId: `stress_ch${pad(chapterNumber)}_commit`,
          startedAt: now,
          updatedAt: now,
          committedAt: now,
          failureReason: null,
          currentStage: 'commit',
          completedStages: ['mission', 'plan_candidates', 'ranking', 'scene_cards', 'scene_drafts', 'draft_assembly', 'diagnostics', 'final', 'canon_patch', 'commit'],
          summary: `Stress chapter ${chapterNumber}.`,
          primaryFunction: 'stress',
          targetDebts: []
        };
      }),
      {
        chapterNumber: chapters + 1,
        title: `Stress Chapter ${chapters + 1}`,
        status: 'planned',
        latestRunId: null,
        startedAt: null,
        updatedAt: now,
        committedAt: null,
        failureReason: null,
        currentStage: 'none',
        completedStages: [],
        summary: 'Next stress chapter.',
        primaryFunction: 'stress',
        targetDebts: []
      }
    ]
  });
}

function artifactTypeFor(artifactPath: string) {
  if (artifactPath.endsWith('mission.json')) return 'mission';
  if (artifactPath.endsWith('selected_plan.md')) return 'selected_plan';
  if (artifactPath.endsWith('final.md')) return 'final';
  if (artifactPath.endsWith('canon_patch.json')) return 'canon_patch';
  if (artifactPath.endsWith('commit_report.json')) return 'commit_report';
  if (artifactPath.startsWith('snapshots/')) return 'snapshot';
  return 'brief';
}

function relativeChapterArtifact(chapterNumber: number, fileName: string): string {
  return path.posix.join('chapters', `chapter_${pad(chapterNumber)}`, fileName);
}

function pad(value: number): string {
  return String(value).padStart(3, '0');
}
