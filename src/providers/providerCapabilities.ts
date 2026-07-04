import type { ProviderCapabilities } from './providerTypes.js';

export const CODEX_TEXT_CAPABILITIES: ProviderCapabilities = {
  providerId: 'codex-text',
  supportsText: true,
  supportsJsonMode: true,
  supportsOutputSchema: true,
  supportsStreamingEvents: true,
  supportsTokenUsage: false,
  supportsCostEstimation: false,
  supportsWorkspaceRead: true,
  supportsWorkspaceWrite: false,
  transport: 'cli',
  defaultSandbox: 'read-only',
  allowCommitByDefault: false,
  supportedProfiles: ['default', 'clean', 'debug']
};

export const STATIC_PROVIDER_CAPABILITIES: ProviderCapabilities[] = [
  {
    providerId: 'mock',
    supportsText: true,
    supportsJsonMode: true,
    supportsOutputSchema: false,
    supportsStreamingEvents: false,
    supportsTokenUsage: false,
    supportsCostEstimation: false,
    supportsWorkspaceRead: false,
    supportsWorkspaceWrite: false,
    transport: 'mock',
    defaultSandbox: 'none',
    allowCommitByDefault: true
  },
  {
    providerId: 'real',
    supportsText: true,
    supportsJsonMode: true,
    supportsOutputSchema: false,
    supportsStreamingEvents: false,
    supportsTokenUsage: true,
    supportsCostEstimation: true,
    supportsWorkspaceRead: false,
    supportsWorkspaceWrite: false,
    transport: 'http',
    defaultSandbox: 'none',
    allowCommitByDefault: true
  },
  {
    providerId: 'openai',
    supportsText: true,
    supportsJsonMode: true,
    supportsOutputSchema: false,
    supportsStreamingEvents: false,
    supportsTokenUsage: true,
    supportsCostEstimation: true,
    supportsWorkspaceRead: false,
    supportsWorkspaceWrite: false,
    transport: 'http',
    defaultSandbox: 'none',
    allowCommitByDefault: true
  },
  CODEX_TEXT_CAPABILITIES
];
