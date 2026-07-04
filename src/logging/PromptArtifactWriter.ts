import path from 'node:path';

import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { RunLogger } from './RunLogger.js';

export interface PromptArtifactWriterOptions {
  env?: Record<string, string | undefined>;
}

export async function writePromptRunArtifacts(
  fileStore: FileStore,
  paths: ProjectPaths,
  runId: string,
  promptId: string,
  renderedPrompt: string,
  responseText: string,
  options: PromptArtifactWriterOptions = {}
): Promise<void> {
  const promptFileBase = promptId.replaceAll('.', '_');
  const promptRunDir = path.join(paths.runDir(runId), 'prompts');
  const redact = shouldRedactPromptArtifacts(options.env ?? process.env);
  const requestText = redact ? redactedContent(promptId, 'request') : renderedPrompt;
  const response = redact ? redactedContent(promptId, 'response') : responseText;
  const requestPath = path.join('runs', runId, 'prompts', `${promptFileBase}_request.md`);
  const responsePath = path.join('runs', runId, 'prompts', `${promptFileBase}_response.md`);

  await fileStore.writeText(path.join(promptRunDir, `${promptFileBase}_request.md`), requestText);
  await fileStore.writeText(path.join(promptRunDir, `${promptFileBase}_response.md`), response);
  try {
    await new RunLogger(paths, fileStore, options).recordPromptArtifacts(
      runId,
      promptId,
      requestPath,
      responsePath,
      redact,
      redact ? 'NLE_REDACT_PROMPT_ARTIFACTS enabled' : undefined
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export function shouldRedactPromptArtifacts(env: Record<string, string | undefined> = process.env): boolean {
  return env.NLE_REDACT_PROMPT_ARTIFACTS === 'true' || env.NLE_REAL_REDACT_PROMPT_ARTIFACTS === 'true';
}

function redactedContent(promptId: string, direction: 'request' | 'response'): string {
  return `[redacted prompt ${direction} artifact for ${promptId}]\n`;
}
