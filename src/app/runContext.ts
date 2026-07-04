import type { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';

export interface RunContext {
  runId: string;
  projectId: string;
  command: string;
  paths: ProjectPaths;
  fileStore: FileStore;
}

export function createRunContext(input: { runId: string; command: string; paths: ProjectPaths; fileStore: FileStore }): RunContext {
  return {
    runId: input.runId,
    projectId: input.paths.projectId,
    command: input.command,
    paths: input.paths,
    fileStore: input.fileStore
  };
}
