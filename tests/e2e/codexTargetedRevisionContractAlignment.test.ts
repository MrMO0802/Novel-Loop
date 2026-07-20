import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { runCodexExpandedTargetRevisionExperiment } from '../../src/app/codexExpandedTargetRevisionExperiment.js';
import { normalizeTargetedRevisionOperations } from '../../src/app/codexTargetedRevisionOperationNormalizer.js';
import {
  ExpandedTargetRevisionPlanSchema,
  NormalizedTargetedRevisionOperationSchema,
  TargetedRevisionOperationNormalizationSchema,
  TargetedRevisionOperationSchema,
  TargetedRevisionProviderOutputSchema
} from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareApprovedExpandedTargetRevisionProject } from './codexExpandedTargetRevisionFixtures.js';
import { normalizationInput, providerOperation } from './codexTargetedRevisionOperationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712d21-alignment-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12D2.1 provider and canonical operation contracts', () => {
  test('Codex output schema uses supported anyOf branches with transport cardinalities', async () => {
    const schema = JSON.parse(await readFile(
      path.join(process.cwd(), 'schemas/codex-output/slim/revision.targeted_operations.slim.schema.json'),
      'utf8'
    )) as {
      properties: {
        operations: {
          items: {
            anyOf: Array<{
              properties: {
                operationType: { enum: string[] };
                targetIds: { minItems: number; maxItems?: number };
              };
            }>;
          };
        };
      };
    };
    const branches = new Map(schema.properties.operations.items.anyOf.map((branch) => [branch.properties.operationType.enum[0], branch]));

    expect(branches.get('replace_paragraph')?.properties.targetIds).toMatchObject({ minItems: 1, maxItems: 1 });
    expect(branches.get('delete_duplicate_paragraph')?.properties.targetIds).toMatchObject({ minItems: 1 });
    expect(branches.get('delete_duplicate_paragraph')?.properties.targetIds.maxItems).toBeUndefined();
    expect(branches.get('merge_target_paragraphs')?.properties.targetIds).toMatchObject({ minItems: 2 });
  });

  test('provider-valid multi-delete normalizes into canonical-valid single-target deletes', () => {
    const providerOutput = {
      operations: [providerOperation('delete_group', 'delete_duplicate_paragraph', ['target_p019', 'target_p020'])]
    };
    expect(TargetedRevisionProviderOutputSchema.safeParse(providerOutput).success).toBe(true);
    expect(TargetedRevisionOperationSchema.safeParse(providerOutput.operations[0]).success).toBe(false);

    const result = normalizeTargetedRevisionOperations(normalizationInput(providerOutput.operations));
    expect(result.report.normalizationSucceeded).toBe(true);
    expect(result.normalizedOperations).toHaveLength(2);
    expect(result.normalizedOperations.every((operation) => NormalizedTargetedRevisionOperationSchema.safeParse(operation).success)).toBe(true);
  });

  test('provider transport contract rejects multi-replace and single-target merge', () => {
    expect(TargetedRevisionProviderOutputSchema.safeParse({
      operations: [providerOperation('replace_many', 'replace_paragraph', ['target_p019', 'target_p020'])]
    }).success).toBe(false);
    expect(TargetedRevisionProviderOutputSchema.safeParse({
      operations: [providerOperation('merge_one', 'merge_target_paragraphs', ['target_p019'])]
    }).success).toBe(false);
  });

  test('D2 pipeline normalizes provider multi-delete before canonical plan application', async () => {
    const store = new FileStore();
    const { paths, fake } = await prepareApprovedExpandedTargetRevisionProject(tempRoot, store, 'codex-expanded-target-multi-delete');
    const protectedBefore = await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ]);

    const result = await runCodexExpandedTargetRevisionExperiment({
      projectId: adjudicationProjectId,
      projectsRoot: tempRoot,
      chapterNumber: 1,
      approval: 'latest',
      revisionRound: 2,
      samples: 1,
      contextMode: 'enhanced',
      codexBin: fake.codexBin
    }, store);

    const plan = await store.readJson(paths.projectArtifact(result.planPath), ExpandedTargetRevisionPlanSchema);
    const normalization = await store.readJson(paths.projectArtifact(result.operationNormalizationPath), TargetedRevisionOperationNormalizationSchema);
    expect(normalization.normalizationSucceeded).toBe(true);
    expect(normalization.operations.some((operation) => operation.normalizationMode === 'atomic_split')).toBe(true);
    expect(plan.operations.filter((operation) => operation.operationType === 'delete_duplicate_paragraph')
      .every((operation) => operation.targetIds.length === 1)).toBe(true);
    expect(await Promise.all([
      store.readText(paths.storyState()),
      store.readText(paths.chapterQueue()),
      store.readText(paths.chapterArtifact(1, 'draft_v1.md'))
    ])).toEqual(protectedBefore);
  }, 60_000);
});
import { readFile } from 'node:fs/promises';
import path from 'node:path';
