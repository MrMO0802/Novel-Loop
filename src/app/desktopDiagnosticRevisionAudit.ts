import type { AuditIssue } from '../schemas/index.js';
import path from 'node:path';
import { DiagnosticRevisionBindingSchema, DiagnosticRevisionCandidateSchema, DiagnosticRevisionDispositionSchema } from '../schemas/desktopDiagnosticRevision.js';
import { readExactSubmissionText } from './desktopSubmissionSource.js';
import type { FileStore } from '../storage/FileStore.js';
import type { ProjectPaths } from '../storage/ProjectPaths.js';
import { listDiagnosticRevisionTasks, readDiagnosticRevisionCandidate } from './desktopDiagnosticRevision.js';

export async function auditDesktopDiagnosticRevisions(paths: ProjectPaths, store: FileStore): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  if (!(await store.exists(paths.projectArtifact('chapters')))) return issues;
  for (const name of await store.list(paths.projectArtifact('chapters'))) {
    const match = /^chapter_(\d{3,})$/u.exec(name);
    if (!match) continue;
    try {
      const scope = { projectRoot: paths.projectRoot, chapterNumber: Number(match[1]) };
      const parent = paths.chapterArtifact(scope.chapterNumber, 'diagnostic_revisions');
      if (await store.exists(parent)) {
        for (const version of await store.list(parent)) {
          if (!/^revision_v[1-9]\d*$/u.test(version)) continue;
          const directory = path.join(parent, version);
          const files = await store.list(directory);
          if (!files.includes('task.json') && files.some(file => /^(?:source_binding\.json|source\.md|candidate\.(?:json|md)|disposition\.json)$/u.test(file))) {
            throw new Error('Revision evidence is missing its publication task.');
          }
        }
      }
      for (const { task, directory } of await listDiagnosticRevisionTasks(scope)) {
        for (const [file, schema] of [['source_binding.json', DiagnosticRevisionBindingSchema], ['candidate.json', DiagnosticRevisionCandidateSchema], ['disposition.json', DiagnosticRevisionDispositionSchema]] as const) {
          const artifact = path.join(directory, file);
          if (await store.exists(artifact)) schema.parse(JSON.parse(await readExactSubmissionText(store, artifact)));
        }
        if (task.status === 'ready' && task.candidateId) await readDiagnosticRevisionCandidate({ ...scope, candidateId: task.candidateId });
      }
    } catch {
      issues.push({ issueId: `diagnostic_revision_${name}`, severity: 'error', category: 'diagnostic_revision_integrity', path: `chapters/${name}/diagnostic_revisions`, message: 'Diagnostic revision evidence is missing, unsafe or inconsistent.', suggestedFix: 'Restore the recorded revision evidence. Do not adopt unverifiable candidates.', blocking: true });
    }
  }
  return issues;
}
