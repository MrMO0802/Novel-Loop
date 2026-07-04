import type { Command } from 'commander';

import { readRunDetail } from '../../app/runBrowser.js';
import { PROJECTS_ROOT_OPTION_HELP } from '../help.js';

interface RunCommandOptions {
  root?: string;
  json?: boolean;
  events?: boolean;
  artifacts?: boolean;
  state?: boolean;
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Inspect one project run manifest')
    .argument('<projectId>', 'project id, e.g. demo-novel')
    .argument('<runId>', 'run id')
    .option('--root <projectsRoot>', PROJECTS_ROOT_OPTION_HELP, './projects')
    .option('--events', 'show event timeline', false)
    .option('--artifacts', 'show artifact lineage', false)
    .option('--state', 'show state mutations and snapshots', false)
    .option('--json', 'print JSON output', false)
    .action(async (projectId: string, runId: string, options: RunCommandOptions) => {
      const detail = await readRunDetail({ projectId, projectsRoot: options.root ?? './projects', runId });
      if (options.json === true) {
        console.log(JSON.stringify(detail, null, 2));
        return;
      }
      console.log(`runId: ${detail.run.runId}`);
      console.log(`schemaVersion: ${detail.schemaVersion}`);
      console.log(`command: ${detail.run.command}`);
      console.log(`status: ${detail.run.status}`);
      console.log(`mode: ${detail.mode}`);
      console.log(`startedAt: ${detail.run.startedAt}`);
      console.log(`endedAt: ${detail.run.endedAt ?? 'none'}`);
      console.log(`durationMs: ${detail.durationMs ?? 'unknown'}`);
      console.log(`provider: ${detail.provider ?? 'unknown'}`);
      console.log(`mockScenario: ${detail.mockScenario ?? 'none'}`);
      console.log(`chapterNumber: ${detail.chapterNumber ?? 'none'}`);
      console.log(`stages: ${detail.stages.join(', ') || 'none'}`);
      console.log(`artifactsGenerated: ${detail.artifactsGenerated.length}`);
      console.log(`artifactsReused: ${detail.artifactsReused.length}`);
      console.log(`artifactsArchived: ${detail.archivedArtifacts.length}`);
      console.log(`errors: ${detail.errors.length}`);
      console.log(`promptCalls: ${detail.promptCalls.length}`);
      console.log(`stateMutations: ${detail.stateMutations.length}`);
      console.log(`snapshotIds: ${detail.snapshotIds.join(', ') || 'none'}`);
      console.log(`queueTransitions: ${detail.queueTransitions.length}`);
      console.log(`redactionPolicy: ${JSON.stringify(detail.redactionPolicy)}`);
      if (options.events === true) {
        console.log('events:');
        for (const event of detail.events) {
          console.log(`- ${event.timestamp} ${event.eventType}${event.stage === undefined ? '' : ` ${event.stage}`}`);
        }
      }
      if (options.artifacts === true) {
        console.log('artifacts:');
        for (const artifact of detail.artifactLineage) {
          console.log(`- ${artifact.action} ${artifact.path} ${artifact.sha256 ?? 'no-hash'}`);
        }
      }
      if (options.state === true) {
        console.log('stateMutations:');
        for (const mutation of detail.stateMutations) {
          console.log(`- ${mutation.mutationType} chapter=${mutation.chapterNumber ?? 'none'} applied=${mutation.applied}`);
        }
      }
    });
}
