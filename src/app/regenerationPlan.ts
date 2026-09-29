import path from 'node:path';

import { ChapterQueueSchema, RegenerationPlanSchema } from '../schemas/index.js';
import type { ChapterQueueItem, RegenerationPlan } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';
import { SnapshotStore } from '../storage/SnapshotStore.js';

export interface GenerateRegenerationPlanInput {
  projectId: string;
  projectsRoot?: string;
  fromChapter: number;
  basedOnStateSnapshotId?: string;
}

export interface GenerateRegenerationPlanResult {
  plan: RegenerationPlan;
  planPath: string;
  markdownPath: string;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function generateRegenerationPlan(
  input: GenerateRegenerationPlanInput,
  fileStore = new FileStore()
): Promise<GenerateRegenerationPlanResult> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const queue = await fileStore.readJson(paths.chapterQueue(), ChapterQueueSchema);
  const staleChapters = queue.chapters
    .filter((chapter) => chapter.status === 'stale_due_to_history_edit' && chapter.chapterNumber >= input.fromChapter)
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
  const artifact = await nextPlanningVersion(paths, fileStore, 'regeneration_plan');
  const basedOnStateSnapshotId = input.basedOnStateSnapshotId ?? (await latestSnapshotId(paths, fileStore));
  const recommendedCommand = `corepack pnpm novel-loop chapter ${paths.projectId} next --provider mock --regenerate-stale --max-revisions 2 --commit`;
  const plan: RegenerationPlan = RegenerationPlanSchema.parse({
    planId: `regeneration_plan_v${artifact.version}`,
    projectId: paths.projectId,
    startsFromChapter: input.fromChapter,
    targetChapters: staleChapters.map((chapter) => targetChapter(paths, chapter, recommendedCommand)),
    basedOnStateSnapshotId,
    generatedAt: new Date().toISOString(),
    strategy: 'regenerate_all_downstream',
    reusePolicy: 'reuse_old_chapter_as_reference_only',
    staleChapters: staleChapters.map((chapter) => chapter.chapterNumber),
    blockedChapters: [],
    recommendedCommands: staleChapters.length === 0 ? [] : [recommendedCommand]
  });

  const written = await fileStore.writeJson(artifact.jsonAbsolutePath, plan, RegenerationPlanSchema);
  await fileStore.writeText(artifact.mdAbsolutePath, renderMarkdown(written));

  return {
    plan: written,
    planPath: artifact.jsonRelativePath,
    markdownPath: artifact.mdRelativePath
  };
}

function targetChapter(paths: ProjectPaths, chapter: ChapterQueueItem, suggestedCommand: string): RegenerationPlan['targetChapters'][number] {
  void paths;
  return {
    chapterNumber: chapter.chapterNumber,
    previousStatus: chapter.status,
    regenerationMode: 'full_pipeline_from_current_canonical_state',
    oldArtifactsArchived: false,
    requiredInputs: [
      'state/story_state.json',
      'planning/chapter_queue.json',
      path.posix.join('chapters', `chapter_${formatChapterNumber(chapter.chapterNumber)}`, 'final.md'),
      path.posix.join('chapters', `chapter_${formatChapterNumber(chapter.chapterNumber)}`, 'canon_patch.json')
    ],
    risks: ['old chapter text may no longer match the edited canonical history'],
    suggestedCommand
  };
}

async function latestSnapshotId(paths: ProjectPaths, fileStore: FileStore): Promise<string> {
  const snapshots = await new SnapshotStore(paths, fileStore).listSnapshots();
  return snapshots.at(-1)?.snapshotId ?? 'none';
}

async function nextPlanningVersion(
  paths: ProjectPaths,
  fileStore: FileStore,
  baseName: string
): Promise<{ version: number; jsonRelativePath: string; mdRelativePath: string; jsonAbsolutePath: string; mdAbsolutePath: string }> {
  await fileStore.ensureDir(paths.planningDir());
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const mdFile = `${baseName}_v${version}.md`;
    const jsonAbsolutePath = paths.planningArtifact(jsonFile);
    if (!(await fileStore.exists(jsonAbsolutePath))) {
      return {
        version,
        jsonRelativePath: path.posix.join('planning', jsonFile),
        mdRelativePath: path.posix.join('planning', mdFile),
        jsonAbsolutePath,
        mdAbsolutePath: paths.planningArtifact(mdFile)
      };
    }
  }
  throw new Error(`Could not allocate planning artifact for ${baseName}.`);
}

function renderMarkdown(plan: RegenerationPlan): string {
  const lines = [
    `# Regeneration Plan ${plan.planId}`,
    '',
    `Project: ${plan.projectId}`,
    `Starts from chapter: ${plan.startsFromChapter}`,
    `Based on snapshot: ${plan.basedOnStateSnapshotId}`,
    `Strategy: ${plan.strategy}`,
    `Reuse policy: ${plan.reusePolicy}`,
    '',
    '## Stale Chapters'
  ];
  if (plan.targetChapters.length === 0) {
    lines.push('- none');
  } else {
    for (const chapter of plan.targetChapters) {
      lines.push(`- Chapter ${chapter.chapterNumber}: ${chapter.suggestedCommand}`);
    }
  }
  lines.push('', '## Recommended Commands');
  if (plan.recommendedCommands.length === 0) {
    lines.push('- none');
  } else {
    for (const command of plan.recommendedCommands) {
      lines.push(`- ${command}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatChapterNumber(chapterNumber: number): string {
  return String(chapterNumber).padStart(3, '0');
}
