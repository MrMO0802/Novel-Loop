import { access, appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

import { AtomicWriter } from './AtomicWriter.js';

export class FileStore {
  constructor(private readonly writer = new AtomicWriter()) {}

  async readText(filePath: string): Promise<string> {
    return readFile(path.resolve(filePath), 'utf8');
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await this.writer.writeText(path.resolve(filePath), content);
  }

  async appendText(filePath: string, content: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await appendFile(resolvedPath, content, 'utf8');
  }

  async ensureDir(dirPath: string): Promise<void> {
    await mkdir(path.resolve(dirPath), { recursive: true });
  }

  async readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
    const text = await this.readText(filePath);
    const parsedJson: unknown = JSON.parse(text);
    return schema.parse(parsedJson);
  }

  async writeJson<T>(filePath: string, value: unknown, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.parse(value);
    const content = `${JSON.stringify(parsed, null, 2)}\n`;
    await this.writeText(filePath, content);
    return parsed;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await access(path.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async list(dirPath: string): Promise<string[]> {
    const entries = await readdir(path.resolve(dirPath));
    return entries.sort((left, right) => left.localeCompare(right));
  }
}
