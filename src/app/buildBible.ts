import path from 'node:path';

import { ProviderFactory, type ProviderName } from '../llm/ProviderFactory.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import { writePromptRunArtifacts } from '../logging/PromptArtifactWriter.js';
import { RunLogger } from '../logging/RunLogger.js';
import { PromptService } from '../prompts/PromptService.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { createRunId } from '../utils/ids.js';

export interface BuildBibleInput {
  projectId: string;
  projectsRoot?: string;
  provider?: ProviderName;
  force?: boolean;
  promptRoot?: string;
  fixturesRoot?: string;
  runId?: string;
  codexBin?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
}

export interface BuildBibleResult {
  projectId: string;
  runId: string;
  artifacts: string[];
}

interface MarkdownPromptArtifact {
  promptId: string;
  outputPath: string;
  relativeOutputPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROMPT_ROOT = './prompts';
const DEFAULT_FIXTURES_ROOT = './fixtures/llm';

const BUILD_BIBLE_PROMPTS: MarkdownPromptArtifact[] = [
  {
    promptId: 'strategy.build_story_bible',
    outputPath: 'story_bible.md',
    relativeOutputPath: 'strategy/story_bible.md'
  },
  {
    promptId: 'strategy.build_genre_contract',
    outputPath: 'genre_contract.md',
    relativeOutputPath: 'strategy/genre_contract.md'
  },
  {
    promptId: 'strategy.build_reader_promise',
    outputPath: 'reader_promise.md',
    relativeOutputPath: 'strategy/reader_promise.md'
  },
  {
    promptId: 'strategy.build_style_guide',
    outputPath: 'style_guide.md',
    relativeOutputPath: 'strategy/style_guide.md'
  }
];

export async function buildBible(input: BuildBibleInput, fileStore = new FileStore()): Promise<BuildBibleResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const provider = input.provider ?? 'mock';
  const runId = input.runId ?? createRunId();
  const runLogger = new RunLogger(paths, fileStore);

  await ensureProjectReady(paths, fileStore);
  await ensureCanWriteOutputs(paths, fileStore, input.force ?? false);
  await runLogger.startRun({
    runId,
    command: 'build-bible',
    args: {
      provider,
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile })
    }
  });

  try {
    const promptService = new PromptService(input.promptRoot ?? DEFAULT_PROMPT_ROOT, fileStore);
    const llmClient = ProviderFactory.create({
      provider,
      projectsRoot: paths.projectsRoot,
      projectId: paths.projectId,
      ...(input.codexBin === undefined ? {} : { codexBin: input.codexBin }),
      ...(input.codexProfile === undefined ? {} : { codexProfile: input.codexProfile }),
      ...(input.codexJsonRetries === undefined ? {} : { codexJsonRetries: input.codexJsonRetries }),
      ...(input.codexJsonRepair === undefined ? {} : { codexJsonRepair: input.codexJsonRepair }),
      ...(input.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: input.codexJsonRepairRetries }),
      fixturesRoot: input.fixturesRoot ?? DEFAULT_FIXTURES_ROOT,
      telemetry: {
        paths,
        runId,
        fileStore
      }
    });
    const brief = await fileStore.readText(paths.brief());
    const artifacts: string[] = [];

    for (const promptArtifact of BUILD_BIBLE_PROMPTS) {
      const renderedPrompt = await promptService.renderPrompt(promptArtifact.promptId, {
        BRIEF: brief
      });
      const response = await llmClient.complete({
        promptId: promptArtifact.promptId,
        system: 'Novel Loop Engine strategy module',
        user: renderedPrompt,
        responseFormat: 'markdown'
      });
      const outputPath = path.join(paths.strategyDir(), promptArtifact.outputPath);

      await writePromptRunArtifacts(fileStore, paths, runId, promptArtifact.promptId, renderedPrompt, response.text);
      await fileStore.writeText(outputPath, response.text);
      await runLogger.recordArtifact(runId, promptArtifact.relativeOutputPath);
      artifacts.push(promptArtifact.relativeOutputPath);
    }

    await runLogger.endRun(runId, 'completed');
    return {
      projectId: paths.projectId,
      runId,
      artifacts
    };
  } catch (error) {
    await runLogger.recordError(runId, {
      code: 'BUILD_BIBLE_FAILED',
      message: getErrorMessage(error),
      recoverable: false
    });
    await runLogger.endRun(runId, 'failed');
    throw error;
  }
}

async function ensureProjectReady(paths: ProjectPaths, fileStore: FileStore): Promise<void> {
  if (!(await fileStore.exists(paths.projectRoot))) {
    throw new AppError('PROJECT_NOT_FOUND', `Project not found: ${paths.projectRoot}`, 2);
  }
  if (!(await fileStore.exists(paths.brief()))) {
    throw new AppError('BRIEF_NOT_FOUND', `Brief file not found: ${paths.brief()}`, 2);
  }
}

async function ensureCanWriteOutputs(paths: ProjectPaths, fileStore: FileStore, force: boolean): Promise<void> {
  if (force) {
    return;
  }

  for (const promptArtifact of BUILD_BIBLE_PROMPTS) {
    const outputPath = path.join(paths.strategyDir(), promptArtifact.outputPath);
    if (await fileStore.exists(outputPath)) {
      throw new AppError('ARTIFACT_ALREADY_EXISTS', `Artifact already exists: ${outputPath}`, 2);
    }
  }
}
