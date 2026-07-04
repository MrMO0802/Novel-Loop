import type { ProviderName } from '../llm/ProviderFactory.js';
import { AppError } from '../utils/AppError.js';

export interface CodexTextSafetyInput {
  provider: ProviderName | undefined;
  projectId: string;
  chapterNumber?: number;
  operation: string;
  suggestedNextCommand?: string;
}

export function blockCodexTextUnsafeOperation(input: CodexTextSafetyInput): void {
  if (input.provider !== 'codex-text') return;

  throw new AppError('CODEX_TEXT_COMMIT_BLOCKED', `codex-text is read-only for this unsafe operation and cannot run ${input.operation}.`, 2, {
    ...(input.chapterNumber === undefined ? {} : { chapterNumber: input.chapterNumber }),
    stage: 'commit',
    reason: `codex-text cannot run ${input.operation}`,
    suggestedNextCommand:
      input.suggestedNextCommand ??
      (input.chapterNumber === undefined
        ? `corepack pnpm novel-loop build-bible ${input.projectId} --provider codex-text`
        : `corepack pnpm novel-loop chapter ${input.projectId} ${input.chapterNumber} --provider codex-text --until draft`)
  });
}
