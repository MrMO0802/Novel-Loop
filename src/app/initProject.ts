import { ConfigSchema, StoryStateSchema } from '../schemas/index.js';
import type { Config, StoryState } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError } from '../utils/AppError.js';

export interface InitProjectInput {
  projectId: string;
  briefPath: string;
  projectsRoot?: string;
}

export interface InitProjectResult {
  projectId: string;
  projectRoot: string;
  created: string[];
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function initProject(input: InitProjectInput, fileStore = new FileStore()): Promise<InitProjectResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);

  if (await fileStore.exists(paths.projectRoot)) {
    throw new AppError('PROJECT_ALREADY_EXISTS', `Project already exists: ${paths.projectRoot}`, 2);
  }

  if (!(await fileStore.exists(input.briefPath))) {
    throw new AppError('BRIEF_NOT_FOUND', `Brief file not found: ${input.briefPath}`, 2);
  }

  const created: string[] = [];
  const requiredDirs = [
    paths.projectRoot,
    paths.strategyDir(),
    paths.stateDir(),
    paths.planningDir(),
    paths.chaptersDir(),
    paths.runsDir(),
    paths.snapshotsDir(),
    paths.diffsDir()
  ];

  for (const dir of requiredDirs) {
    await fileStore.ensureDir(dir);
    created.push(dir);
  }

  const brief = await fileStore.readText(input.briefPath);
  await fileStore.writeText(paths.brief(), brief);
  created.push(paths.brief());

  await fileStore.writeJson(paths.config(), createDefaultConfig(paths.projectId), ConfigSchema);
  created.push(paths.config());

  await fileStore.writeJson(paths.storyState(), createInitialStoryState(paths.projectId), StoryStateSchema);
  created.push(paths.storyState());

  return {
    projectId: paths.projectId,
    projectRoot: paths.projectRoot,
    created
  };
}

export function createDefaultConfig(projectId: string): Config {
  return ConfigSchema.parse({
    projectId,
    language: 'zh-CN',
    defaultProvider: 'mock',
    qualityThreshold: 8.2,
    chapter: {
      defaultCandidateCount: 3,
      maxRevisionAttempts: 3,
      targetWordCount: 3500,
      sceneMinCount: 3,
      sceneMaxCount: 8
    },
    llm: {
      temperature: {
        planning: 0.6,
        writing: 0.85,
        diagnostics: 0.2,
        revision: 0.45
      }
    },
    storage: {
      snapshotOnCommit: true,
      atomicWrites: true
    }
  });
}

export function createInitialStoryState(projectId: string, updatedAt = new Date().toISOString()): StoryState {
  return StoryStateSchema.parse({
    schemaVersion: '1.0',
    projectId,
    language: 'zh-CN',
    latestCommittedChapter: 0,
    canonFacts: [],
    characters: [],
    worldRules: [],
    timeline: [],
    plotThreads: [],
    narrativeDebts: [],
    foreshadowing: [],
    readerState: {
      readerKnows: [],
      readerSuspects: [],
      readerQuestions: [],
      readerExpectations: [],
      readerDoesNotKnow: []
    },
    relationshipGraph: {
      nodes: [],
      edges: []
    },
    revealSchedule: [],
    updatedAt
  });
}
