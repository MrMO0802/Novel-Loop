import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

import { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';

const CodexNormalizationErrorSchema = z.object({
  errorType: z.literal('CODEX_NORMALIZATION_FAILED'),
  projectId: z.string(),
  runId: z.string(),
  promptId: z.string(),
  stage: z.string(),
  generatedAt: z.string(),
  message: z.string(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  storyStateMutated: z.literal(false),
  redacted: z.literal(true)
});

export async function normalizeCodexOutput<T>(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: {
    runId?: string | undefined;
    promptId: string;
    stage: string;
    value: unknown;
    normalize: () => T;
  }
): Promise<T> {
  try {
    return input.normalize();
  } catch (error) {
    const runId = input.runId ?? 'untracked';
    const relativePath = path.posix.join('codex', 'failures', runId, 'normalization_error.json');
    await fileStore.writeJson(
      paths.projectArtifact(relativePath),
      {
        errorType: 'CODEX_NORMALIZATION_FAILED',
        projectId: paths.projectId,
        runId,
        promptId: input.promptId,
        stage: input.stage,
        generatedAt: new Date().toISOString(),
        message: getErrorMessage(error),
        inputHash: sha256(JSON.stringify(input.value)),
        storyStateMutated: false,
        redacted: true
      },
      CodexNormalizationErrorSchema
    );
    throw new AppError('CODEX_NORMALIZATION_FAILED', `Codex slim output normalization failed for ${input.promptId}: ${getErrorMessage(error)}`, 1, {
      promptId: input.promptId,
      normalizationErrorPath: relativePath
    });
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
