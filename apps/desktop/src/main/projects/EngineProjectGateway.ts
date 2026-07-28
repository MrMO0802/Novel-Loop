import type {
  DesktopProjectBriefInput,
  DesktopProjectInspection
} from 'novel-loop-engine/desktop';

export interface ProjectEngineGateway {
  create(input: {
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }): Promise<void>;
  inspect(projectRoot: string): Promise<DesktopProjectInspection>;
}

export class EngineProjectGateway implements ProjectEngineGateway {
  async create(input: {
    projectsRoot: string;
    projectId: string;
    brief: DesktopProjectBriefInput;
  }): Promise<void> {
    const { createDesktopProject } = await import('novel-loop-engine/desktop');
    await createDesktopProject(input);
  }

  async inspect(projectRoot: string): Promise<DesktopProjectInspection> {
    const { inspectDesktopProject } = await import('novel-loop-engine/desktop');
    return inspectDesktopProject({ projectRoot });
  }
}
