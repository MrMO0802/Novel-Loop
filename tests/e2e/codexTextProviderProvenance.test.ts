import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildBible } from '../../src/app/buildBible.js';
import { auditProject } from '../../src/app/projectAudit.js';
import { initProject } from '../../src/app/initProject.js';
import { planGlobal } from '../../src/app/planGlobal.js';
import { RunManifestSchema } from '../../src/schemas/index.js';
import { FileStore } from '../../src/storage/FileStore.js';
import { ProjectPaths } from '../../src/storage/ProjectPaths.js';
import { writeFakeCodex } from '../helpers/fakeCodex.js';
import { briefPath, projectId, promptRoot } from './m16Helpers.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-loop-m22-provenance-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('codex-text provider provenance and redaction', () => {
  test('records codex-text prompt calls, artifacts, events, and redacted raw output', async () => {
    const fake = await writeFakeCodex(tempRoot);
    const store = new FileStore();
    await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
    await buildBible({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'run_m22_codex_provenance'
    }, store);
    const paths = new ProjectPaths(tempRoot, projectId);
    const manifest = await store.readJson(paths.runManifest('run_m22_codex_provenance'), RunManifestSchema);
    if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') {
      throw new Error('expected run manifest v2');
    }

    expect(manifest.promptCalls.every((call) => call.provider === 'codex-text')).toBe(true);
    expect(manifest.promptCalls[0]).toMatchObject({
      transport: 'cli',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 9.9.9',
      redacted: true
    });
    expect(manifest.promptCalls[0]?.rawOutputPath).toMatch(/^codex\/runs\//);
    expect(manifest.promptCalls[0]?.finalOutputPath).toMatch(/^codex\/runs\//);
    const parentCall = manifest.promptCalls[0];
    expect(parentCall?.promptCallId).toMatch(/^prompt_001_/);
    expect(parentCall?.requestId).toMatch(/^run_m22_codex_provenance_codex_001_/);
    if (parentCall?.requestId === undefined || parentCall.promptCallId === undefined) throw new Error('missing parent call identity');
    const childManifest = await store.readJson(paths.runManifest(parentCall.requestId), RunManifestSchema);
    if (!('schemaVersion' in childManifest) || childManifest.schemaVersion !== '2') throw new Error('expected child v2');
    expect(childManifest.promptCalls[0]).toMatchObject({
      provider: 'codex-cli',
      wrapperCallType: 'exec_text',
      parentPromptCallId: parentCall.promptCallId,
      parentPromptId: parentCall.promptId,
      parentRunId: 'run_m22_codex_provenance',
      attributionMode: 'parent_child',
      attributionConfidence: 'high'
    });
    expect(manifest.artifacts.map((artifact) => artifact.artifactType)).toEqual(expect.arrayContaining(['codex_raw_output', 'codex_final_output']));
    const events = await store.readText(paths.runEvents('run_m22_codex_provenance'));
    expect(events).toContain('PROMPT_CALL_COMPLETED');
    expect(events).toContain('ARTIFACT_GENERATED');

    const rawOutputPath = manifest.promptCalls[0]?.rawOutputPath;
    if (rawOutputPath === undefined) throw new Error('missing raw output path');
    const raw = await store.readText(paths.projectArtifact(rawOutputPath));
    expect(raw).not.toContain('sk-SECRET');
    expect(raw).not.toContain('auth.json');

    await planGlobal({
      projectId,
      projectsRoot: tempRoot,
      provider: 'codex-text',
      promptRoot,
      codexBin: fake.codexBin,
      runId: 'run_m22_codex_provenance_plan'
    }, store);
    const audit = await auditProject({ projectId, projectsRoot: tempRoot, strict: true, fixIndex: true }, store);
    expect(audit.exitCode).toBe(0);
  });

  test('redacts prompt artifacts when NLE_REDACT_PROMPT_ARTIFACTS=true', async () => {
    const original = process.env.NLE_REDACT_PROMPT_ARTIFACTS;
    process.env.NLE_REDACT_PROMPT_ARTIFACTS = 'true';
    try {
      const fake = await writeFakeCodex(tempRoot);
      const store = new FileStore();
      await initProject({ projectId, projectsRoot: tempRoot, briefPath }, store);
      await buildBible({
        projectId,
        projectsRoot: tempRoot,
        provider: 'codex-text',
        promptRoot,
        codexBin: fake.codexBin,
        runId: 'run_m22_codex_redaction'
      }, store);
      const paths = new ProjectPaths(tempRoot, projectId);
      const requestArtifact = await store.readText(paths.projectArtifact('runs/run_m22_codex_redaction/prompts/strategy_build_story_bible_request.md'));
      expect(requestArtifact).toContain('[redacted prompt request artifact');
      const manifest = await store.readJson(paths.runManifest('run_m22_codex_redaction'), RunManifestSchema);
      if (!('schemaVersion' in manifest) || manifest.schemaVersion !== '2') throw new Error('expected v2');
      expect(manifest.promptCalls[0]?.redacted).toBe(true);
    } finally {
      if (original === undefined) delete process.env.NLE_REDACT_PROMPT_ARTIFACTS;
      else process.env.NLE_REDACT_PROMPT_ARTIFACTS = original;
    }
  });
});
