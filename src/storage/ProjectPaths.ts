import path from 'node:path';

import { ProjectIdSchema } from '../schemas/index.js';

export class ProjectPaths {
  readonly projectsRoot: string;
  readonly projectId: string;
  readonly projectRoot: string;

  constructor(projectsRoot: string, projectId: string) {
    this.projectsRoot = path.resolve(projectsRoot);
    this.projectId = ProjectIdSchema.parse(projectId);
    this.projectRoot = path.join(this.projectsRoot, this.projectId);
  }

  config(): string {
    return path.join(this.projectRoot, 'config.json');
  }

  brief(): string {
    return path.join(this.projectRoot, 'brief.md');
  }

  strategyDir(): string {
    return path.join(this.projectRoot, 'strategy');
  }

  stateDir(): string {
    return path.join(this.projectRoot, 'state');
  }

  storyState(): string {
    return path.join(this.stateDir(), 'story_state.json');
  }

  planningDir(): string {
    return path.join(this.projectRoot, 'planning');
  }

  chapterQueue(): string {
    return path.join(this.planningDir(), 'chapter_queue.json');
  }

  chaptersDir(): string {
    return path.join(this.projectRoot, 'chapters');
  }

  chapterDir(chapterNumber: number): string {
    return path.join(this.chaptersDir(), this.formatChapterDir(chapterNumber));
  }

  chapterArtifact(chapterNumber: number, ...segments: string[]): string {
    return path.join(this.chapterDir(chapterNumber), ...segments);
  }

  projectArtifact(relativePath: string): string {
    return path.join(this.projectRoot, relativePath);
  }

  planningArtifact(...segments: string[]): string {
    return path.join(this.planningDir(), ...segments);
  }

  runsDir(): string {
    return path.join(this.projectRoot, 'runs');
  }

  artifactsDir(): string {
    return path.join(this.projectRoot, 'artifacts');
  }

  artifactIndex(): string {
    return path.join(this.artifactsDir(), 'artifact_index.json');
  }

  auditDir(): string {
    return path.join(this.projectRoot, 'audit');
  }

  auditArtifact(fileName: string): string {
    return path.join(this.auditDir(), fileName);
  }

  runDir(runId: string): string {
    return path.join(this.runsDir(), runId);
  }

  runManifest(runId: string): string {
    return path.join(this.runDir(runId), 'run_manifest.json');
  }

  runEvents(runId: string): string {
    return path.join(this.runDir(runId), 'events.ndjson');
  }

  snapshotsDir(): string {
    return path.join(this.projectRoot, 'snapshots');
  }

  diffsDir(): string {
    return path.join(this.projectRoot, 'diffs');
  }

  diffArtifact(fileName: string): string {
    return path.join(this.diffsDir(), fileName);
  }

  snapshot(snapshotId: string): string {
    return path.join(this.snapshotsDir(), `${snapshotId}.json`);
  }

  private formatChapterDir(chapterNumber: number): string {
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      throw new Error('chapterNumber must be a positive integer');
    }

    return `chapter_${String(chapterNumber).padStart(3, '0')}`;
  }
}
