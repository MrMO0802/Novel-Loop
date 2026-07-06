import { AppError } from '../utils/AppError.js';
import { CodexTextProvider } from '../providers/codexTextProvider.js';
import type { CodexProfile } from '../providers/providerTypes.js';
import type { LLMClient } from './LLMClient.js';
import { MockLLMClient, type MockFixtureValue, type MockLLMClientOptions } from './MockLLMClient.js';
import { RealLLMClient } from './RealLLMClient.js';
import { loadRealProviderConfig } from './RealProviderConfig.js';
import { TelemetryLLMClient, type LLMClientTelemetryOptions } from './TelemetryLLMClient.js';

export type ProviderName = 'mock' | 'real' | 'openai' | 'custom' | 'codex-text';

export interface ProviderFactoryOptions {
  provider: ProviderName;
  fixturesRoot?: string;
  fixtures?: Record<string, MockFixtureValue>;
  scenario?: string;
  envPath?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  telemetry?: Omit<LLMClientTelemetryOptions, 'provider'>;
  codexBin?: string;
  projectsRoot?: string;
  projectId?: string;
  codexProfile?: CodexProfile;
  codexJsonRetries?: number;
  codexJsonRepair?: boolean;
  codexJsonRepairRetries?: number;
  codexTimeoutMs?: number;
}

export class ProviderFactory {
  static create(options: ProviderFactoryOptions): LLMClient {
    let client: LLMClient;

    if (options.provider === 'mock') {
      const mockOptions: MockLLMClientOptions = {};

      if (options.fixturesRoot !== undefined) {
        mockOptions.fixturesRoot = options.fixturesRoot;
      }
      if (options.fixtures !== undefined) {
        mockOptions.fixtures = options.fixtures;
      }
      if (options.scenario !== undefined) {
        mockOptions.scenario = options.scenario;
      }

      client = new MockLLMClient(mockOptions);
    } else if (options.provider === 'real' || options.provider === 'openai') {
      client = new RealLLMClient({
        config: loadRealProviderConfig(options.envPath === undefined ? {} : { envPath: options.envPath }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep })
      });
    } else if (options.provider === 'codex-text') {
      client = new CodexTextProvider({
        ...(options.codexBin === undefined ? {} : { codexBin: options.codexBin }),
        ...(options.projectsRoot === undefined ? {} : { projectsRoot: options.projectsRoot }),
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        ...(options.codexProfile === undefined ? {} : { codexProfile: options.codexProfile }),
        ...(options.codexJsonRetries === undefined ? {} : { codexJsonRetries: options.codexJsonRetries }),
        ...(options.codexJsonRepair === undefined ? {} : { codexJsonRepair: options.codexJsonRepair }),
        ...(options.codexJsonRepairRetries === undefined ? {} : { codexJsonRepairRetries: options.codexJsonRepairRetries }),
        ...(options.codexTimeoutMs === undefined ? {} : { codexTimeoutMs: options.codexTimeoutMs }),
        ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry })
      });
    } else {
      throw new AppError('PROVIDER_NOT_IMPLEMENTED', `Provider is not implemented: ${options.provider}`, 2);
    }

    if (options.provider === 'codex-text') {
      return client;
    }

    if (options.telemetry !== undefined) {
      return new TelemetryLLMClient(client, {
        ...options.telemetry,
        provider: options.provider
      });
    }

    return client;
  }
}
