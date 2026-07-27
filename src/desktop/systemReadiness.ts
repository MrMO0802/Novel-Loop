import { z } from 'zod';

import {
  checkCodexStatus,
  type CodexBoundaryInput,
  type CodexStatusResult
} from '../app/codexBoundary.js';
import { AppError } from '../utils/AppError.js';

const DesktopSystemReadinessSchema = z.object({
  checkedAt: z.string().datetime(),
  codex: z.object({
    canRunSmoke: z.boolean(),
    status: z.enum([
      'ready',
      'not_installed',
      'not_logged_in',
      'warning',
      'unavailable'
    ]),
    summary: z.string().min(1),
    version: z.string().min(1).nullable()
  }).strict()
}).strict();

export type DesktopSystemReadiness = z.infer<
  typeof DesktopSystemReadinessSchema
>;

export type CodexStatusChecker = (
  input?: CodexBoundaryInput
) => Promise<CodexStatusResult>;

export async function getDesktopSystemReadiness(
  input: CodexBoundaryInput = {},
  checkStatus: CodexStatusChecker = checkCodexStatus
): Promise<DesktopSystemReadiness> {
  const checkedAt = new Date().toISOString();

  try {
    const status = await checkStatus(input);
    const loggedIn = isLoggedIn(status.loginStatus);

    if (!loggedIn) {
      return parseReadiness({
        checkedAt,
        codex: {
          canRunSmoke: false,
          status: 'not_logged_in',
          summary: 'Codex 已安装，但尚未登录。',
          version: normalizeVersion(status.version)
        }
      });
    }

    if (!status.healthOk) {
      return parseReadiness({
        checkedAt,
        codex: {
          canRunSmoke: true,
          status: 'warning',
          summary: 'Codex 可以使用，但环境检查返回了提醒。',
          version: normalizeVersion(status.version)
        }
      });
    }

    return parseReadiness({
      checkedAt,
      codex: {
        canRunSmoke: true,
        status: 'ready',
        summary: '本地 Codex 已准备好。',
        version: normalizeVersion(status.version)
      }
    });
  } catch (error) {
    if (
      error instanceof AppError
      && error.code === 'CODEX_BINARY_NOT_FOUND'
    ) {
      return parseReadiness({
        checkedAt,
        codex: {
          canRunSmoke: false,
          status: 'not_installed',
          summary: '尚未检测到本地 Codex。',
          version: null
        }
      });
    }

    return parseReadiness({
      checkedAt,
      codex: {
        canRunSmoke: false,
        status: 'unavailable',
        summary: '暂时无法检查本地 Codex 状态。',
        version: null
      }
    });
  }
}

function isLoggedIn(loginStatus: string): boolean {
  if (/not\s+logged\s+in|logged\s+out|not\s+authenticated/i.test(loginStatus)) {
    return false;
  }

  return /logged\s+in|authenticated/i.test(loginStatus);
}

function normalizeVersion(version: string): string | null {
  const normalized = version.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseReadiness(input: unknown): DesktopSystemReadiness {
  return DesktopSystemReadinessSchema.parse(input);
}
