import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const RegistryPathSchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(path.isAbsolute, 'Registry paths must be absolute.');
const ProjectRegistryProjectSchema = z.object({
  projectKey: z.string().trim().min(1).max(96),
  projectRoot: RegistryPathSchema,
  title: z.string().trim().min(1).max(160),
  addedAt: z.string().max(40).datetime(),
  lastOpenedAt: z.string().max(40).datetime()
}).strict();
const ProjectRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  defaultLibraryRoot: RegistryPathSchema.nullable(),
  projects: z.array(ProjectRegistryProjectSchema).max(5_000)
}).strict();

export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;
export type ProjectRegistryProject = z.infer<typeof ProjectRegistryProjectSchema>;

export interface ProjectRegistryStore {
  load(): Promise<{
    registry: ProjectRegistry;
    warning: 'registry_unavailable' | null;
  }>;
  save(registry: ProjectRegistry): Promise<void>;
}

export interface ProjectRegistryFileSystem {
  mkdir(directoryPath: string, options: { recursive: true }): Promise<string | undefined>;
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  writeFile(
    filePath: string,
    contents: string,
    options: { encoding: 'utf8'; mode: number }
  ): Promise<void>;
}

const nodeFileSystem: ProjectRegistryFileSystem = {
  mkdir: (directoryPath, options) => fs.mkdir(directoryPath, options),
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  rename: (sourcePath, destinationPath) => fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  writeFile: (filePath, contents, options) => fs.writeFile(filePath, contents, options)
};

export class FileProjectRegistryStore implements ProjectRegistryStore {
  readonly registryPath: string;

  constructor(
    userDataPath: string,
    private readonly fileSystem: ProjectRegistryFileSystem = nodeFileSystem
  ) {
    this.registryPath = path.join(path.resolve(userDataPath), 'project-registry.json');
  }

  async load(): Promise<{
    registry: ProjectRegistry;
    warning: 'registry_unavailable' | null;
  }> {
    try {
      await this.ensureUserDataDirectory();
      const contents = await this.fileSystem.readFile(this.registryPath, 'utf8');
      const registry = ProjectRegistrySchema.parse(JSON.parse(contents));
      return { registry, warning: null };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { registry: createEmptyRegistry(), warning: null };
      }
      return { registry: createEmptyRegistry(), warning: 'registry_unavailable' };
    }
  }

  async save(registry: ProjectRegistry): Promise<void> {
    const validatedRegistry = ProjectRegistrySchema.parse(registry);
    const temporaryPath = `${this.registryPath}.tmp-${randomUUID()}`;

    await this.ensureUserDataDirectory();
    try {
      await this.fileSystem.writeFile(
        temporaryPath,
        `${JSON.stringify(validatedRegistry, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      await this.fileSystem.rename(temporaryPath, this.registryPath);
    } catch (error) {
      await this.removeTemporaryFile(temporaryPath);
      throw error;
    }
  }

  private async ensureUserDataDirectory(): Promise<void> {
    await this.fileSystem.mkdir(path.dirname(this.registryPath), { recursive: true });
  }

  private async removeTemporaryFile(temporaryPath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created before the failed operation.
    }
  }
}

export function upsertRegistryProject(
  registry: ProjectRegistry,
  project: ProjectRegistryProject
): ProjectRegistry {
  const normalizedProject = {
    ...project,
    projectRoot: path.resolve(project.projectRoot)
  };
  const retainedProjects = retainUniqueProjects(registry.projects).filter((candidate) => (
    candidate.projectKey !== normalizedProject.projectKey
      && path.resolve(candidate.projectRoot) !== normalizedProject.projectRoot
  ));

  return {
    ...registry,
    projects: [...retainedProjects, normalizedProject]
  };
}

export function removeRegistryProject(
  registry: ProjectRegistry,
  projectKey: string
): ProjectRegistry {
  return {
    ...registry,
    projects: registry.projects.filter((project) => project.projectKey !== projectKey)
  };
}

function createEmptyRegistry(): ProjectRegistry {
  return {
    schemaVersion: 1,
    defaultLibraryRoot: null,
    projects: []
  };
}

function retainUniqueProjects(projects: ProjectRegistryProject[]): ProjectRegistryProject[] {
  const paths = new Set<string>();
  const uniqueProjects: ProjectRegistryProject[] = [];

  for (const project of [...projects].reverse()) {
    const canonicalPath = path.resolve(project.projectRoot);
    if (paths.has(canonicalPath)) {
      continue;
    }
    paths.add(canonicalPath);
    uniqueProjects.push(project);
  }

  return uniqueProjects.reverse();
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
