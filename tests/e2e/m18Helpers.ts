import { recommitChapter } from '../../src/app/recommitChapter.js';
import { runChapterFullProduction } from '../../src/app/chapterPipeline.js';
import { FileStore } from '../../src/storage/FileStore.js';
import type { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { fixturesRoot, prepareCommittedThreeChapterProject, projectId, promptRoot } from './m16Helpers.js';

export async function prepareStaleChapter3Project(tempRoot: string): Promise<ProjectPaths> {
  const paths = await prepareCommittedThreeChapterProject(tempRoot);
  await recommitChapter(
    {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 2,
      sourceType: 'final',
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      mockScenario: 'historical-recommit-chapter-2-valid',
      allowHistoricalRecommit: true,
      markDownstreamStale: true,
      confirm: true
    },
    new FileStore()
  );
  return paths;
}

export async function regenerateStaleChapter3(tempRoot: string, reusePolicy?: string) {
  return runChapterFullProduction(
    {
      projectId,
      projectsRoot: tempRoot,
      chapterNumber: 3,
      provider: 'mock',
      promptRoot,
      fixturesRoot,
      candidates: 3,
      maxRevisions: 2,
      commit: true,
      regenerateStale: true,
      runId: 'run_m18_regenerate_stale_ch3',
      ...(reusePolicy === undefined ? {} : { reusePolicy })
    },
    new FileStore()
  );
}
