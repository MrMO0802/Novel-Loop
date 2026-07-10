import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';

import { runCodexDiagnosticsEvidenceAdjudication } from '../../src/app/codexDiagnosticsEvidenceAdjudication.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { CodexDiagnosticsEvidenceAdjudicationSchema, TimelineContradictionMapSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { createTempRoot, removeTempRoot } from './m16Helpers.js';
import { adjudicationProjectId, prepareDiagnosticsAdjudicationProject } from './codexDiagnosticsAdjudicationFixtures.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await createTempRoot('novel-loop-m2712b-map-');
});

afterEach(async () => {
  await removeTempRoot(tempRoot);
});

describe('M27.12B timeline contradiction map audit', () => {
  test('maps valid event references and strict audit rejects broken evidence and node references', async () => {
    const store = new FileStore();
    const { paths } = await prepareDiagnosticsAdjudicationProject(tempRoot, store);
    const result = await runCodexDiagnosticsEvidenceAdjudication({ projectId: adjudicationProjectId, projectsRoot: tempRoot, chapterNumber: 1 }, store);
    const map = await store.readJson(paths.projectArtifact(result.timelineMapPath), TimelineContradictionMapSchema);
    const nodeIds = new Set(map.eventNodes.map((node) => node.eventId));
    expect(map.temporalEdges.every((edge) => nodeIds.has(edge.fromEventId) && nodeIds.has(edge.toEventId))).toBe(true);

    const report = await store.readJson(paths.projectArtifact(result.reportPath), CodexDiagnosticsEvidenceAdjudicationSchema);
    const brokenReport = { ...report, draftEvidence: report.draftEvidence.map((evidence, index) => index === 0 ? { ...evidence, path: 'chapters/chapter_001/missing_draft.md' } : evidence) };
    const brokenMap = { ...map, temporalEdges: map.temporalEdges.map((edge, index) => index === 0 ? { ...edge, fromEventId: 'missing_event' } : edge) };
    await store.writeJson(paths.projectArtifact(result.reportPath), brokenReport, z.unknown());
    await store.writeJson(paths.projectArtifact(result.timelineMapPath), brokenMap, z.unknown());

    const audit = await auditProject({ projectId: adjudicationProjectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.ok).toBe(false);
    expect(audit.exitCode).toBe(2);
    expect(audit.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'diagnostics_evidence_adjudication', blocking: true }),
      expect.objectContaining({ category: 'timeline_contradiction_map', blocking: true })
    ]));
  }, 30_000);
});
