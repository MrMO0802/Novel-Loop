import path from 'node:path';

import { ProvenanceCompactionReportSchema, RunEventSchema } from '../schemas/index.js';
import type { ProvenanceCompactionReport, RunEvent } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface CompactProvenanceInput {
  projectId: string;
  projectsRoot?: string;
  maxEventsPerRun: number;
  apply?: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function compactProvenance(input: CompactProvenanceInput, fileStore = new FileStore()): Promise<ProvenanceCompactionReport> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const maxEventsPerRun = assertPositive(input.maxEventsPerRun, 'maxEventsPerRun');
  const runIds = (await fileStore.exists(paths.runsDir())) ? await fileStore.list(paths.runsDir()) : [];
  const compactedRuns: ProvenanceCompactionReport['compactedRuns'] = [];
  let totalEventsRemoved = 0;

  for (const runId of runIds) {
    const eventsPath = paths.runEvents(runId);
    if (!(await fileStore.exists(eventsPath))) {
      continue;
    }
    const events = parseEvents(await fileStore.readText(eventsPath));
    if (events.length <= maxEventsPerRun) {
      continue;
    }
    const compacted = compactEvents(paths.projectId, runId, events, maxEventsPerRun);
    totalEventsRemoved += events.length - compacted.length;
    const relativeEventsPath = path.posix.join('runs', runId, 'events.ndjson');
    const originalEventsPath = path.posix.join('runs', runId, 'events.full.ndjson');
    compactedRuns.push({
      runId,
      originalEventCount: events.length,
      compactedEventCount: compacted.length,
      eventsPath: relativeEventsPath,
      originalEventsPath
    });
    if (input.apply === true) {
      await fileStore.writeText(paths.projectArtifact(originalEventsPath), events.map((event) => `${JSON.stringify(event)}`).join('\n') + '\n');
      await fileStore.writeText(eventsPath, compacted.map((event) => `${JSON.stringify(event)}`).join('\n') + '\n');
    }
  }

  const reportArtifact = await nextAuditArtifact(paths, fileStore, 'provenance_compaction');
  const report = ProvenanceCompactionReportSchema.parse({
    reportId: `provenance_compaction_v${reportArtifact.version}`,
    projectId: paths.projectId,
    generatedAt: new Date().toISOString(),
    applied: input.apply === true,
    maxEventsPerRun,
    scannedRuns: runIds.length,
    compactedRuns,
    totalEventsRemoved,
    reportPath: reportArtifact.relativeJsonPath,
    notes: [
      input.apply === true
        ? 'Oversized event logs were compacted and original logs were copied to events.full.ndjson.'
        : 'Preview only; no event logs were modified.'
    ]
  });
  const written = await fileStore.writeJson(reportArtifact.jsonPath, report, ProvenanceCompactionReportSchema);
  await fileStore.writeText(reportArtifact.mdPath, renderCompactionMarkdown(written));
  return written;
}

function parseEvents(text: string): RunEvent[] {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => RunEventSchema.parse(JSON.parse(line)));
}

function compactEvents(projectId: string, runId: string, events: RunEvent[], maxEventsPerRun: number): RunEvent[] {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const compactedEvent = RunEventSchema.parse({
    eventId: `${runId}_PROVENANCE_COMPACTED`,
    runId,
    projectId,
    timestamp: last.timestamp,
    eventType: 'PROVENANCE_COMPACTED',
    stage: 'provenance_compaction',
    payload: {
      originalEventCount: events.length,
      retainedEventCount: Math.min(maxEventsPerRun, 3)
    },
    relatedArtifactPaths: [path.posix.join('runs', runId, 'events.full.ndjson')],
    severity: 'info'
  });
  if (maxEventsPerRun <= 1) {
    return [compactedEvent];
  }
  if (maxEventsPerRun === 2) {
    return [first, compactedEvent];
  }
  return [first, compactedEvent, last].slice(0, maxEventsPerRun);
}

async function nextAuditArtifact(paths: ProjectPaths, fileStore: FileStore, baseName: string) {
  for (let version = 1; version < 1000; version += 1) {
    const jsonFile = `${baseName}_v${version}.json`;
    const jsonPath = paths.auditArtifact(jsonFile);
    if (!(await fileStore.exists(jsonPath))) {
      const mdFile = `${baseName}_v${version}.md`;
      return {
        version,
        jsonPath,
        mdPath: paths.auditArtifact(mdFile),
        relativeJsonPath: path.posix.join('audit', jsonFile)
      };
    }
  }
  throw new Error(`Could not allocate ${baseName}.`);
}

function renderCompactionMarkdown(report: ProvenanceCompactionReport): string {
  return [
    `# Provenance Compaction ${report.reportId}`,
    '',
    `Applied: ${String(report.applied)}`,
    `Scanned runs: ${report.scannedRuns}`,
    `Compacted runs: ${report.compactedRuns.length}`,
    `Events removed: ${report.totalEventsRemoved}`,
    ''
  ].join('\n');
}

function assertPositive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
