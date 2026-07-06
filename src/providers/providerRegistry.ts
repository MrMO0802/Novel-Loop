import path from 'node:path';

import { execCodexJsonPrompt, runCodexSmoke, checkCodexStatus } from '../app/codexBoundary.js';
import { AppError, getErrorMessage } from '../utils/AppError.js';
import { CODEX_TEXT_CAPABILITIES, STATIC_PROVIDER_CAPABILITIES } from './providerCapabilities.js';
import type { ProviderHealth, ProviderId, ProviderInspectResult, ProviderListItem, ProviderReleaseStatus } from './providerTypes.js';

export interface ProviderRegistryOptions {
  codexBin?: string;
  projectsRoot?: string;
  projectId?: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';
const DEFAULT_PROJECT_ID = 'codex-boundary';

export function listProviders(): ProviderListItem[] {
  return STATIC_PROVIDER_CAPABILITIES.map((capabilities) => ({
    providerId: capabilities.providerId,
    capabilities,
    releaseStatus: providerReleaseStatus(capabilities.providerId)
  }));
}

function providerReleaseStatus(providerId: ProviderId): ProviderReleaseStatus {
  if (providerId === 'mock') return 'stable-rc';
  if (providerId === 'codex-text') return 'pilot-rc';
  return 'legacy-out-of-scope';
}

export async function inspectProvider(providerId: ProviderId, options: ProviderRegistryOptions = {}): Promise<ProviderInspectResult> {
  if (providerId !== 'codex-text') {
    const capabilities = STATIC_PROVIDER_CAPABILITIES.find((provider) => provider.providerId === providerId);
    if (capabilities === undefined) {
      throw new AppError('PROVIDER_NOT_IMPLEMENTED', `Provider is not implemented: ${providerId}`, 2);
    }
    return {
      providerId,
      capabilities,
      health: {
        providerId,
        binaryAvailable: true,
        loginAvailable: true,
        doctorHealthy: true,
        execSmokeOk: true,
        execJsonOk: capabilities.supportsJsonMode,
        providerAvailable: true,
        available: true
      },
      commitSafetyPolicy: {
        allowCommitByDefault: capabilities.allowCommitByDefault,
        storyStateCommitAllowed: capabilities.allowCommitByDefault,
        workspaceWriteAllowed: capabilities.supportsWorkspaceWrite,
        sandbox: 'read-only'
      }
    };
  }

  const health = await inspectCodexTextHealth(options);
  return {
    providerId: 'codex-text',
    capabilities: CODEX_TEXT_CAPABILITIES,
    health,
    commitSafetyPolicy: {
      allowCommitByDefault: false,
      storyStateCommitAllowed: false,
      workspaceWriteAllowed: false,
      sandbox: 'read-only'
    }
  };
}

async function inspectCodexTextHealth(options: ProviderRegistryOptions): Promise<ProviderHealth> {
  const projectsRoot = options.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  let status: Awaited<ReturnType<typeof checkCodexStatus>> | undefined;
  let smokeOk = false;
  let jsonOk = false;
  const boundaryInput = {
    projectsRoot,
    projectId,
    ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin })
  };
  try {
    status = await checkCodexStatus(boundaryInput);
  } catch (error) {
    return {
      providerId: 'codex-text',
      binaryAvailable: false,
      loginAvailable: false,
      doctorHealthy: false,
      execSmokeOk: false,
      execJsonOk: false,
      providerAvailable: false,
      available: false,
      doctorStatus: getErrorMessage(error)
    };
  }

  try {
    await runCodexSmoke(boundaryInput);
    smokeOk = true;
  } catch {
    smokeOk = false;
  }

  try {
    await execCodexJsonPrompt({
      ...boundaryInput,
      promptText: 'PROMPT_ID: provider.health\nReturn {"ok": true}.',
      schemaPath: path.resolve('schemas', 'codex-output', 'provider.health.schema.json')
    });
    jsonOk = true;
  } catch {
    jsonOk = false;
  }

  const providerAvailable = status.binaryFound && !status.loginStatus.startsWith('Codex CLI command failed') && smokeOk && jsonOk;
  return {
    providerId: 'codex-text',
    binaryAvailable: true,
    loginAvailable: !status.loginStatus.startsWith('Codex CLI command failed'),
    doctorHealthy: status.healthOk,
    execSmokeOk: smokeOk,
    execJsonOk: jsonOk,
    providerAvailable,
    available: providerAvailable,
    binaryPath: status.binaryPath,
    version: status.version,
    loginStatus: status.loginStatus,
    doctorStatus: status.healthOk ? 'healthy' : 'unhealthy'
  };
}
