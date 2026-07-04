import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { readFileMetadata } from './fileHash.js';
import { CodexContextManifestSchema } from '../schemas/index.js';
import type { CodexContextArtifact, CodexContextManifest } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';

export interface WriteCodexContextInput {
  task: string;
  includedArtifacts: Array<{ path: string; reason: string; summary?: string }>;
  excludedArtifacts?: Array<{ path: string; reason: string; summary?: string }>;
  maxContextChars?: number;
}

export async function writeCodexContextManifest(
  paths: ProjectPaths,
  fileStore: FileStore,
  input: WriteCodexContextInput
): Promise<{ manifest: CodexContextManifest; relativePath: string }> {
  const version = await nextContextManifestVersion(paths, fileStore);
  const relativePath = path.posix.join('codex', 'context', `context_manifest_v${version}.json`);
  const includedArtifacts = await enrichArtifacts(paths, fileStore, input.includedArtifacts);
  const excludedArtifacts = await enrichArtifacts(paths, fileStore, input.excludedArtifacts ?? defaultExcludedArtifacts());
  const manifest = CodexContextManifestSchema.parse({
    manifestId: `context_manifest_v${version}`,
    projectId: paths.projectId,
    task: input.task,
    generatedAt: new Date().toISOString(),
    includedArtifacts,
    excludedArtifacts,
    maxContextChars: input.maxContextChars ?? 8000,
    contextHash: sha256(JSON.stringify({ includedArtifacts, excludedArtifacts, task: input.task }))
  });
  await fileStore.writeJson(paths.projectArtifact(relativePath), manifest, CodexContextManifestSchema);
  return { manifest, relativePath };
}

async function nextContextManifestVersion(paths: ProjectPaths, fileStore: FileStore): Promise<number> {
  const contextDir = paths.projectArtifact(path.posix.join('codex', 'context'));
  if (!(await fileStore.exists(contextDir))) return 1;
  const files = await fileStore.list(contextDir);
  const versions = files
    .map((file) => /^context_manifest_v(\d+)\.json$/.exec(file)?.[1])
    .filter((version): version is string => version !== undefined)
    .map((version) => Number.parseInt(version, 10));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

async function enrichArtifacts(
  paths: ProjectPaths,
  fileStore: FileStore,
  artifacts: Array<{ path: string; reason: string; summary?: string }>
): Promise<CodexContextArtifact[]> {
  const enriched: CodexContextArtifact[] = [];
  for (const artifact of artifacts) {
    const absolutePath = paths.projectArtifact(artifact.path);
    if (await fileStore.exists(absolutePath)) {
      const stats = await stat(path.resolve(absolutePath));
      if (stats.isDirectory()) {
        enriched.push({
          path: artifact.path,
          reason: artifact.reason,
          ...(artifact.summary === undefined ? {} : { summary: artifact.summary })
        });
        continue;
      }
      const metadata = await readFileMetadata(absolutePath, fileStore);
      enriched.push({
        path: artifact.path,
        reason: artifact.reason,
        ...(artifact.summary === undefined ? {} : { summary: artifact.summary }),
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256
      });
    } else {
      enriched.push({
        path: artifact.path,
        reason: artifact.reason,
        ...(artifact.summary === undefined ? {} : { summary: artifact.summary })
      });
    }
  }
  return enriched;
}

function defaultExcludedArtifacts(): Array<{ path: string; reason: string; summary?: string }> {
  return [
    {
      path: 'runs/',
      reason: 'not needed for generation; too large and provenance-only'
    },
    {
      path: 'codex/runs/',
      reason: 'not needed for generation; raw Codex artifacts are excluded from prompt context'
    },
    {
      path: 'chapters/',
      reason: 'not needed for this planning task unless a chapter-specific context builder includes selected files'
    }
  ];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
