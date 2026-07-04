import { randomBytes } from 'node:crypto';

import { SnapshotSchema, StoryStateSchema } from '../schemas/index.js';
import type { Snapshot, SnapshotMeta } from '../schemas/index.js';
import { FileStore } from './FileStore.js';
import { ProjectPaths } from './ProjectPaths.js';

export interface SnapshotStoreOptions {
  now?: () => Date;
  randomSuffix?: () => string;
}

export interface CreateSnapshotInput {
  reason: string;
  sourceChapter?: number;
  runId?: string;
  configHash?: string;
}

export class SnapshotStore {
  private readonly now: () => Date;
  private readonly randomSuffix: () => string;

  constructor(
    private readonly paths: ProjectPaths,
    private readonly fileStore = new FileStore(),
    options: SnapshotStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomSuffix = options.randomSuffix ?? (() => randomBytes(3).toString('hex'));
  }

  async createSnapshot(storyStateInput: unknown, input: CreateSnapshotInput): Promise<SnapshotMeta> {
    const storyState = StoryStateSchema.parse(storyStateInput);
    const createdAt = this.now().toISOString();
    const snapshotId = `snapshot_${this.formatTimestamp(this.now())}_${this.randomSuffix()}`;
    const snapshotPath = this.paths.snapshot(snapshotId);
    const meta = this.buildMeta(snapshotId, snapshotPath, createdAt, input);
    const snapshot: Snapshot = {
      meta,
      storyState
    };

    const writtenSnapshot = await this.fileStore.writeJson(snapshotPath, snapshot, SnapshotSchema);
    return writtenSnapshot.meta;
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    if (!(await this.fileStore.exists(this.paths.snapshotsDir()))) {
      return [];
    }

    const entries = await this.fileStore.list(this.paths.snapshotsDir());
    const metas: SnapshotMeta[] = [];

    for (const entry of entries) {
      if (!entry.startsWith('snapshot_') || !entry.endsWith('.json')) {
        continue;
      }

      const snapshotId = entry.slice(0, -'.json'.length);
      const snapshot = await this.readSnapshot(snapshotId);
      metas.push(snapshot.meta);
    }

    return metas.sort((left, right) => left.snapshotId.localeCompare(right.snapshotId));
  }

  async readSnapshot(snapshotId: string): Promise<Snapshot> {
    return this.fileStore.readJson(this.paths.snapshot(snapshotId), SnapshotSchema);
  }

  private buildMeta(snapshotId: string, snapshotPath: string, createdAt: string, input: CreateSnapshotInput): SnapshotMeta {
    const meta: SnapshotMeta = {
      snapshotId,
      path: snapshotPath,
      createdAt,
      reason: input.reason
    };

    if (input.sourceChapter !== undefined) {
      meta.sourceChapter = input.sourceChapter;
    }
    if (input.runId !== undefined) {
      meta.runId = input.runId;
    }
    if (input.configHash !== undefined) {
      meta.configHash = input.configHash;
    }

    return meta;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }
}
