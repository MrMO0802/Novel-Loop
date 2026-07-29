import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  DesktopProjectBriefInput,
  DesktopProjectInspection
} from 'novel-loop-engine/desktop';

import {
  ProjectLibraryResultSchema,
  type CreateProjectRequest,
  type LibraryLocationSelection,
  type ProjectLibraryResult,
  type ProjectOpenResult,
  type ProjectSummary
} from '../../shared/projectContract';
import type { ProjectDialogPort } from '../dialogs/NativeProjectDialog';
import {
  removeRegistryProject,
  upsertRegistryProject,
  type ProjectRegistry,
  type ProjectRegistryProject,
  type ProjectRegistryStore
} from './ProjectRegistryStore';
import type { ProjectEngineGateway } from './EngineProjectGateway';

export type { ProjectDialogPort } from '../dialogs/NativeProjectDialog';
export type { ProjectEngineGateway } from './EngineProjectGateway';

export interface ProjectLibraryApplicationService {
  list(): Promise<ProjectLibraryResult>;
  chooseDefaultLibrary(): Promise<LibraryLocationSelection>;
  create(input: CreateProjectRequest): Promise<ProjectOpenResult>;
  openExisting(): Promise<ProjectOpenResult>;
  open(projectKey: string): Promise<ProjectOpenResult>;
  remove(projectKey: string): Promise<ProjectLibraryResult>;
}

export interface ProjectLibraryServiceDependencies {
  registry: ProjectRegistryStore;
  dialog: ProjectDialogPort;
  gateway: ProjectEngineGateway;
  clock?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}

export class ProjectLibraryService implements ProjectLibraryApplicationService {
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;

  constructor(private readonly dependencies: ProjectLibraryServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  }

  async list(): Promise<ProjectLibraryResult> {
    try {
      const { registry, warning } = await this.dependencies.registry.load();
      return await this.toLibraryResult(registry, warning);
    } catch {
      return unavailableLibraryResult();
    }
  }

  async chooseDefaultLibrary(): Promise<LibraryLocationSelection> {
    const registry = await this.loadRegistryForMutation();
    if (registry === null) {
      return { selection: 'location_unavailable' };
    }

    try {
      const selected = await this.dependencies.dialog.chooseDefaultLibrary();
      if (selected === null) return { selection: 'cancelled' };
      const libraryRoot = await canonicalLibraryPath(selected);
      if (libraryRoot === null) return { selection: 'location_unavailable' };
      await this.dependencies.registry.save({ ...registry, defaultLibraryRoot: libraryRoot });
      return { selection: 'selected', locationLabel: path.basename(libraryRoot) };
    } catch {
      return { selection: 'location_unavailable' };
    }
  }

  async create(input: CreateProjectRequest): Promise<ProjectOpenResult> {
    const registry = await this.loadRegistryForMutation();
    if (registry === null) {
      return { outcome: 'failed' };
    }
    const root = await this.resolveCreationRoot(input, registry);
    if (typeof root !== 'string') {
      return root;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const projectId = this.generateProjectId();
      const projectRoot = path.join(root, projectId);
      const targetState = await targetPathState(projectRoot);
      if (targetState === 'unavailable') return { outcome: 'failed' };
      if (targetState === 'exists') {
        if (attempt === 0) continue;
        return { outcome: 'project_exists' };
      }
      try {
        await this.dependencies.gateway.create({
          projectsRoot: root,
          projectId,
          brief: toDesktopBrief(input)
        });
      } catch (error) {
        if (isProjectAlreadyExistsError(error) && attempt === 0) continue;
        return isProjectAlreadyExistsError(error) ? { outcome: 'project_exists' } : { outcome: 'failed' };
      }
      const canonicalProjectRoot = await canonicalProjectPath(projectRoot);
      if (canonicalProjectRoot === null) return { outcome: 'failed' };
      const inspection = await this.inspect(canonicalProjectRoot);
      if (inspection === null || !inspection.valid) return { outcome: 'failed' };
      const project = await this.saveOpenedProject(
        registry,
        canonicalProjectRoot,
        inspection,
        this.generateProjectKey()
      );
      return project === null ? { outcome: 'failed' } : { outcome: 'created', project };
    }
    return { outcome: 'project_exists' };
  }

  async openExisting(): Promise<ProjectOpenResult> {
    const registry = await this.loadRegistryForMutation();
    if (registry === null) {
      return { outcome: 'failed' };
    }

    try {
      const selected = await this.dependencies.dialog.chooseProjectDirectory();
      if (selected === null) return { outcome: 'cancelled' };
      const projectRoot = await canonicalProjectPath(selected);
      return projectRoot === null
        ? { outcome: 'location_unavailable' }
        : this.openProjectRoot(projectRoot, registry);
    } catch {
      return { outcome: 'failed' };
    }
  }

  async open(projectKey: string): Promise<ProjectOpenResult> {
    const registry = await this.loadRegistryForMutation();
    if (registry === null) {
      return { outcome: 'failed' };
    }
    const saved = registry.projects.find((project) => project.projectKey === projectKey);
    if (saved === undefined) return { outcome: 'invalid_project' };
    const projectRoot = await canonicalProjectPath(saved.projectRoot);
    return projectRoot === null
      ? { outcome: 'location_unavailable' }
      : this.openProjectRoot(projectRoot, registry, saved.projectKey);
  }

  async remove(projectKey: string): Promise<ProjectLibraryResult> {
    try {
      const loaded = await this.dependencies.registry.load();
      if (loaded.warning !== null) {
        return unavailableLibraryResult();
      }
      const { registry } = loaded;
      const updated = removeRegistryProject(registry, projectKey);
      await this.dependencies.registry.save(updated);
      return await this.toLibraryResult(updated, null);
    } catch {
      return {
        projects: [],
        defaultLocation: { configured: false, locationLabel: null },
        warning: 'registry_unavailable'
      };
    }
  }

  async resolveProjectRoot(projectKey: string): Promise<string | null> {
    try {
      const loaded = await this.dependencies.registry.load();
      if (loaded.warning !== null) return null;
      const project = loaded.registry.projects.find((candidate) => candidate.projectKey === projectKey);
      if (project === undefined) return null;
      const projectRoot = await canonicalProjectPath(project.projectRoot);
      if (projectRoot === null) return null;
      const inspection = await this.inspect(projectRoot);
      return inspection?.valid === true ? projectRoot : null;
    } catch {
      return null;
    }
  }

  private async resolveCreationRoot(
    input: CreateProjectRequest,
    registry: ProjectRegistry
  ): Promise<string | ProjectOpenResult> {
    try {
      const selected = input.useDifferentLocation
        ? await this.dependencies.dialog.chooseAlternateLibrary()
        : registry.defaultLibraryRoot;
      if (selected === null) {
        return input.useDifferentLocation ? { outcome: 'cancelled' } : { outcome: 'location_required' };
      }
      return (await canonicalLibraryPath(selected)) ?? { outcome: 'location_unavailable' };
    } catch {
      return { outcome: 'failed' };
    }
  }

  private async openProjectRoot(
    projectRoot: string,
    loadedRegistry?: ProjectRegistry,
    knownProjectKey?: string
  ): Promise<ProjectOpenResult> {
    const inspection = await this.inspect(projectRoot);
    if (inspection === null) return { outcome: 'failed' };
    if (!inspection.valid) return { outcome: 'invalid_project' };
    let registry = loadedRegistry;
    if (registry === undefined) {
      try {
        registry = (await this.dependencies.registry.load()).registry;
      } catch {
        return { outcome: 'failed' };
      }
    }
    const project = await this.saveOpenedProject(registry, projectRoot, inspection, knownProjectKey);
    return project === null ? { outcome: 'failed' } : { outcome: 'opened', project };
  }

  private async inspectSavedProject(project: ProjectRegistryProject): Promise<ProjectSummary> {
    const projectRoot = await canonicalProjectPath(project.projectRoot);
    if (projectRoot === null) {
      return needsAttentionSummary(project, path.dirname(project.projectRoot));
    }
    const inspection = await this.inspect(projectRoot);
    return inspection === null || !inspection.valid
      ? needsAttentionSummary(project, path.dirname(projectRoot))
      : summaryFromInspection(project.projectKey, project.lastOpenedAt, projectRoot, inspection);
  }

  private async inspect(projectRoot: string): Promise<DesktopProjectInspection | null> {
    try {
      return await this.dependencies.gateway.inspect(projectRoot);
    } catch {
      return null;
    }
  }

  private async loadRegistryForMutation(): Promise<ProjectRegistry | null> {
    try {
      const loaded = await this.dependencies.registry.load();
      return loaded.warning === null ? loaded.registry : null;
    } catch {
      return null;
    }
  }

  private async saveOpenedProject(
    registry: ProjectRegistry,
    projectRoot: string,
    inspection: Extract<DesktopProjectInspection, { valid: true }>,
    requestedProjectKey?: string
  ): Promise<ProjectSummary | null> {
    try {
      const duplicate = await findProjectByCanonicalRoot(registry.projects, projectRoot);
      const projectKey = requestedProjectKey ?? duplicate?.projectKey ?? this.generateProjectKey();
      const lastOpenedAt = this.clock().toISOString();
      const updated = upsertRegistryProject({
        ...registry,
        projects: await removeCanonicalAliases(registry.projects, projectRoot)
      }, {
        projectKey,
        projectRoot,
        title: inspection.title,
        addedAt: duplicate?.addedAt ?? lastOpenedAt,
        lastOpenedAt
      });
      await this.dependencies.registry.save(updated);
      return summaryFromInspection(projectKey, lastOpenedAt, projectRoot, inspection);
    } catch {
      return null;
    }
  }

  private generateProjectId(): string {
    const date = this.clock();
    return `novel-${date.getUTCFullYear()}${twoDigits(date.getUTCMonth() + 1)}${twoDigits(date.getUTCDate())}`
      + `-${twoDigits(date.getUTCHours())}${twoDigits(date.getUTCMinutes())}${twoDigits(date.getUTCSeconds())}`
      + `-${toHex(this.randomBytes(3))}`;
  }

  private generateProjectKey(): string {
    return `project_${toHex(this.randomBytes(12))}`;
  }

  private async toLibraryResult(
    registry: ProjectRegistry,
    warning: 'registry_unavailable' | null
  ): Promise<ProjectLibraryResult> {
    return ProjectLibraryResultSchema.parse({
      projects: await Promise.all(registry.projects.map((project) => this.inspectSavedProject(project))),
      defaultLocation: {
        configured: registry.defaultLibraryRoot !== null,
        locationLabel: registry.defaultLibraryRoot === null
          ? null
          : path.basename(registry.defaultLibraryRoot)
      },
      warning
    });
  }
}

function summaryFromInspection(
  projectKey: string,
  lastOpenedAt: string,
  projectRoot: string,
  inspection: Extract<DesktopProjectInspection, { valid: true }>
): ProjectSummary {
  return {
    projectKey,
    title: inspection.title,
    latestCommittedChapter: inspection.latestCommittedChapter,
    health: 'ready',
    lastOpenedAt,
    briefExcerpt: inspection.briefExcerpt,
    locationLabel: path.basename(path.dirname(projectRoot)),
    storyBibleAvailable: inspection.storyBibleAvailable,
    globalPlanAvailable: inspection.globalPlanAvailable
  };
}

function needsAttentionSummary(project: ProjectRegistryProject, projectsRoot: string): ProjectSummary {
  return {
    projectKey: project.projectKey,
    title: project.title,
    latestCommittedChapter: 0,
    health: 'needs_attention',
    lastOpenedAt: project.lastOpenedAt,
    briefExcerpt: null,
    locationLabel: path.basename(projectsRoot),
    storyBibleAvailable: false,
    globalPlanAvailable: false
  };
}

async function canonicalLibraryPath(candidate: string): Promise<string | null> {
  return canonicalDirectory(candidate, constants.R_OK | constants.W_OK);
}

async function canonicalProjectPath(candidate: string): Promise<string | null> {
  return canonicalDirectory(candidate, constants.R_OK);
}

async function canonicalDirectory(candidate: string, accessMode: number): Promise<string | null> {
  try {
    const canonical = await realpath(candidate);
    if (!(await stat(canonical)).isDirectory()) return null;
    await access(canonical, accessMode);
    return canonical;
  } catch {
    return null;
  }
}

async function targetPathState(candidate: string): Promise<'exists' | 'missing' | 'unavailable'> {
  try {
    await lstat(candidate);
    return 'exists';
  } catch (error) {
    return isMissingPathError(error) ? 'missing' : 'unavailable';
  }
}

async function findProjectByCanonicalRoot(
  projects: ProjectRegistryProject[],
  projectRoot: string
): Promise<ProjectRegistryProject | undefined> {
  for (const project of projects) {
    if (await canonicalProjectPath(project.projectRoot) === projectRoot) return project;
  }
  return undefined;
}

async function removeCanonicalAliases(
  projects: ProjectRegistryProject[],
  projectRoot: string
): Promise<ProjectRegistryProject[]> {
  const retained: ProjectRegistryProject[] = [];
  for (const project of projects) {
    if (await canonicalProjectPath(project.projectRoot) !== projectRoot) retained.push(project);
  }
  return retained;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function isProjectAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'PROJECT_ALREADY_EXISTS';
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function unavailableLibraryResult(): ProjectLibraryResult {
  return {
    projects: [],
    defaultLocation: { configured: false, locationLabel: null },
    warning: 'registry_unavailable'
  };
}

function toDesktopBrief(input: CreateProjectRequest): DesktopProjectBriefInput {
  const brief: DesktopProjectBriefInput = {
    title: input.title,
    coreIdea: input.coreIdea
  };
  if (input.genre !== undefined) brief.genre = input.genre;
  if (input.protagonist !== undefined) brief.protagonist = input.protagonist;
  if (input.worldPremise !== undefined) brief.worldPremise = input.worldPremise;
  return brief;
}
