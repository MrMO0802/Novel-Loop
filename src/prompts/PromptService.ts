import path from 'node:path';

import { FileStore } from '../storage/FileStore.js';
import { TemplateRenderer, type TemplateValues } from './TemplateRenderer.js';

export class PromptService {
  private readonly promptRoot: string;

  constructor(
    promptRoot = './prompts',
    private readonly fileStore = new FileStore(),
    private readonly renderer = new TemplateRenderer()
  ) {
    this.promptRoot = path.resolve(promptRoot);
  }

  async loadTemplate(promptId: string): Promise<string> {
    return this.fileStore.readText(this.resolvePromptPath(promptId));
  }

  async renderPrompt(promptId: string, values: TemplateValues): Promise<string> {
    const template = await this.loadTemplate(promptId);
    return this.renderer.render(template, values);
  }

  resolvePromptPath(promptId: string): string {
    const parts = promptId.split('.');
    if (parts.length < 2 || parts.some((part) => part.length === 0)) {
      throw new Error(`Invalid promptId: ${promptId}`);
    }

    const fileName = `${parts.at(-1)}.md`;
    const directories = parts.slice(0, -1);
    return path.join(this.promptRoot, ...directories, fileName);
  }
}
