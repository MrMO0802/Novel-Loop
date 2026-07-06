import path from 'node:path';

import { resolveBundledAssetPath } from '../runtime/packageAssets.js';
import { FileStore } from '../storage/FileStore.js';
import { JsonResponseParser } from './JsonResponseParser.js';
import type { LLMClient, LLMRequest, LLMResponse } from './LLMClient.js';

export type MockFixtureValue = string | LLMResponse;

export interface MockLLMClientOptions {
  fixturesRoot?: string;
  fixtures?: Record<string, MockFixtureValue>;
  scenario?: string;
  parser?: JsonResponseParser;
  fileStore?: FileStore;
}

export class MockLLMClient implements LLMClient {
  private readonly fixturesRoot: string | undefined;
  private readonly fixtures: Record<string, MockFixtureValue>;
  private readonly scenario: string;
  private readonly parser: JsonResponseParser;
  private readonly fileStore: FileStore;

  constructor(options: MockLLMClientOptions = {}) {
    this.fixturesRoot = options.fixturesRoot ? resolveBundledAssetPath(options.fixturesRoot, 'fixtures/llm') : undefined;
    this.fixtures = options.fixtures ?? {};
    this.scenario = options.scenario ?? 'default';
    this.parser = options.parser ?? new JsonResponseParser();
    this.fileStore = options.fileStore ?? new FileStore();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const fixture = await this.resolveFixture(request);
    const response = this.toResponse(fixture);

    if (request.responseFormat === 'json') {
      return {
        ...response,
        json: response.json ?? this.parser.parse(response.text),
        model: response.model ?? 'mock'
      };
    }

    return {
      ...response,
      model: response.model ?? 'mock'
    };
  }

  private async resolveFixture(request: LLMRequest): Promise<MockFixtureValue> {
    const fixtureScenario = this.getFixtureScenario(request);
    const keyedFixture = this.resolveMapFixture(request.promptId, fixtureScenario);
    if (keyedFixture !== undefined) {
      return keyedFixture;
    }

    if (this.fixturesRoot === undefined) {
      throw new Error(`No mock fixture configured for promptId: ${request.promptId}`);
    }

    for (const fixturePath of this.candidateFixturePaths(request)) {
      if (await this.fileStore.exists(fixturePath)) {
        return this.fileStore.readText(fixturePath);
      }
    }

    throw new Error(`No mock fixture found for promptId: ${request.promptId} scenario: ${fixtureScenario}`);
  }

  private resolveMapFixture(promptId: string, fixtureScenario: string): MockFixtureValue | undefined {
    return this.fixtures[`${promptId}.${fixtureScenario}`] ?? this.fixtures[promptId];
  }

  private candidateFixturePaths(request: LLMRequest): string[] {
    const extensions = request.responseFormat === 'json' ? ['json', 'txt', 'md'] : ['md', 'txt', 'json'];
    const requestedScenario = this.getFixtureScenario(request);
    const scenarioNames = requestedScenario === 'default' ? ['default'] : [requestedScenario, 'default'];
    const candidates: string[] = [];

    for (const scenarioName of scenarioNames) {
      for (const extension of extensions) {
        candidates.push(path.join(this.fixturesRoot ?? '', `${request.promptId}.${scenarioName}.${extension}`));
      }
    }

    for (const extension of extensions) {
      candidates.push(path.join(this.fixturesRoot ?? '', `${request.promptId}.${extension}`));
    }

    return candidates;
  }

  private getFixtureScenario(request: LLMRequest): string {
    const metadataScenario = request.metadata?.fixtureScenario;
    if (typeof metadataScenario === 'string' && metadataScenario.length > 0) {
      return metadataScenario;
    }

    return this.scenario;
  }

  private toResponse(fixture: MockFixtureValue): LLMResponse {
    if (typeof fixture === 'string') {
      return {
        text: fixture
      };
    }

    return {
      ...fixture,
      text: fixture.text ?? (fixture.json === undefined ? '' : JSON.stringify(fixture.json))
    };
  }
}
