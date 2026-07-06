import type { LLMRequest } from '../llm/LLMClient.js';

export type ProviderId = 'mock' | 'real' | 'openai' | 'custom' | 'codex-text';
export type ProviderTransport = 'mock' | 'http' | 'cli';
export type CodexProfile = 'default' | 'clean' | 'debug';
export type ProviderReleaseStatus = 'stable-rc' | 'pilot-rc' | 'legacy-out-of-scope';

export interface ProviderCapabilities {
  providerId: ProviderId;
  supportsText: boolean;
  supportsJsonMode: boolean;
  supportsOutputSchema: boolean;
  supportsStreamingEvents: boolean;
  supportsTokenUsage: boolean;
  supportsCostEstimation: boolean;
  supportsWorkspaceRead: boolean;
  supportsWorkspaceWrite: boolean;
  transport: ProviderTransport;
  defaultSandbox: 'read-only' | 'workspace-write' | 'danger-full-access' | 'none';
  allowCommitByDefault: boolean;
  supportedProfiles?: CodexProfile[];
}

export interface ProviderHealth {
  providerId: ProviderId;
  binaryAvailable: boolean;
  loginAvailable: boolean;
  doctorHealthy: boolean;
  execSmokeOk: boolean;
  execJsonOk: boolean;
  providerAvailable: boolean;
  available: boolean;
  binaryPath?: string;
  version?: string;
  loginStatus?: string;
  doctorStatus?: string;
}

export interface ProviderInspectResult {
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  health: ProviderHealth;
  commitSafetyPolicy: {
    allowCommitByDefault: boolean;
    storyStateCommitAllowed: boolean;
    workspaceWriteAllowed: boolean;
    sandbox: 'read-only';
  };
}

export interface ProviderListItem {
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  releaseStatus: ProviderReleaseStatus;
}

export interface LLMTextResult {
  ok: boolean;
  provider: ProviderId;
  model: string;
  text: string;
  rawResponseRedacted: string;
  latencyMs: number;
  requestId?: string;
  finishReason?: string;
  error?: ProviderErrorInfo;
}

export interface LLMJsonResult extends LLMTextResult {
  parsed: unknown;
  jsonParsed: boolean;
  schemaValid: boolean;
  schemaName?: string;
}

export interface ProviderErrorInfo {
  code: string;
  message: string;
  provider: ProviderId;
  recoverable: boolean;
}

export interface ProviderTextRequest extends LLMRequest {}

export interface ProviderJsonRequest extends LLMRequest {
  metadata?: LLMRequest['metadata'] & {
    outputSchemaPath?: string;
    schemaName?: string;
  };
}
