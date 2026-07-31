import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

import { AtomicWriter } from './AtomicWriter.js';
import { ProjectPathGuard } from './ProjectPathGuard.js';
import {
  afterProjectOperationWrite,
  beforeProjectOperationWrite
} from '../app/projectOperationLease.js';

export class FileStore {
  constructor(
    private readonly writer = new AtomicWriter(),
    private readonly pathGuard?: ProjectPathGuard
  ) {}

  static forProject(projectRoot: string): FileStore {
    const guard = new ProjectPathGuard(projectRoot);
    return new FileStore(
      new AtomicWriter(
        {},
        (filePath) => guard.assertSafePath(filePath),
        guard.projectRoot
      ),
      guard
    );
  }

  async assertSafePath(filePath: string): Promise<void> {
    await this.pathGuard?.assertSafePath(path.resolve(filePath));
  }

  async readText(filePath: string): Promise<string> {
    const resolvedPath = path.resolve(filePath);
    await this.assertSafePath(resolvedPath);
    return readFile(resolvedPath, 'utf8');
  }

  async writeText(filePath: string, content: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    await this.assertSafePath(resolvedPath);
    await beforeProjectOperationWrite(resolvedPath);
    await this.writer.writeText(resolvedPath, content);
    await afterProjectOperationWrite(resolvedPath, content);
  }

  async appendText(filePath: string, content: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    await this.assertSafePath(resolvedPath);
    await beforeProjectOperationWrite(resolvedPath);
    await this.writer.appendText(resolvedPath, content);
  }

  async ensureDir(dirPath: string): Promise<void> {
    const resolvedPath = path.resolve(dirPath);
    await this.assertSafePath(resolvedPath);
    await beforeProjectOperationWrite(resolvedPath);
    await this.writer.ensureDir(resolvedPath);
    await this.assertSafePath(resolvedPath);
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
    const resolvedPath = path.resolve(filePath);
    await this.assertSafePath(resolvedPath);
    try {
      await access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  async list(dirPath: string): Promise<string[]> {
    const resolvedPath = path.resolve(dirPath);
    await this.assertSafePath(resolvedPath);
    const entries = await readdir(resolvedPath);
    return entries.sort((left, right) => left.localeCompare(right));
  }
}
