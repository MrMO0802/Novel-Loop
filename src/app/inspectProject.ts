import { StoryStateSchema } from '../schemas/index.js';
import { FileStore } from '../storage/FileStore.js';
import { ProjectPaths } from '../storage/ProjectPaths.js';

export interface InspectProjectInput {
  projectId: string;
  projectsRoot?: string;
  debts?: boolean;
  characters?: boolean;
  reader?: boolean;
  timeline?: boolean;
  foreshadowing?: boolean;
}

const DEFAULT_PROJECTS_ROOT = './projects';

export async function inspectProject(input: InspectProjectInput, fileStore = new FileStore()): Promise<string> {
  const paths = new ProjectPaths(input.projectsRoot ?? DEFAULT_PROJECTS_ROOT, input.projectId);
  const state = await fileStore.readJson(paths.storyState(), StoryStateSchema);
  const lines: string[] = [
    `Project: ${state.projectId}`,
    `Latest committed chapter: ${state.latestCommittedChapter}`,
    `Canon facts: ${state.canonFacts.length}`,
    `Characters: ${state.characters.length}`,
    `Open debts: ${state.narrativeDebts.filter((debt) => debt.status === 'open' || debt.status === 'partially_paid').length}`
  ];

  if (input.debts === true) {
    lines.push('', 'Open Narrative Debts');
    const openDebts = state.narrativeDebts.filter((debt) => debt.status === 'open' || debt.status === 'escalated' || debt.status === 'partially_paid');
    if (openDebts.length === 0) {
      lines.push('- none');
    }
    for (const debt of openDebts) {
      lines.push(`- ${debt.id} [${debt.status}] ${debt.readerQuestion}`);
    }
  }

  if (input.characters === true) {
    lines.push('', 'Characters');
    if (state.characters.length === 0) {
      lines.push('- none');
    }
    for (const character of state.characters) {
      lines.push(`- ${character.id} ${character.name}: ${character.currentGoal ?? 'no current goal'} / ${character.emotionalState ?? 'unknown emotion'}`);
    }
  }

  if (input.reader === true) {
    lines.push('', 'Reader State');
    appendStringList(lines, 'Knows', state.readerState.readerKnows);
    appendStringList(lines, 'Suspects', state.readerState.readerSuspects);
    appendStringList(lines, 'Expects', state.readerState.readerExpectations);
  }

  if (input.timeline === true) {
    lines.push('', 'Timeline');
    if (state.timeline.length === 0) {
      lines.push('- none');
    }
    for (const event of state.timeline) {
      lines.push(`- ${event.id} ch${event.chapter}: ${event.summary}`);
    }
  }

  if (input.foreshadowing === true) {
    lines.push('', 'Foreshadowing');
    if (state.foreshadowing.length === 0) {
      lines.push('- none');
    }
    for (const foreshadowing of state.foreshadowing) {
      lines.push(`- ${foreshadowing.id} [${foreshadowing.status}] ${foreshadowing.surfaceDetail}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function appendStringList(lines: string[], label: string, values: string[]): void {
  lines.push(`${label}:`);
  if (values.length === 0) {
    lines.push('- none');
    return;
  }
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}
