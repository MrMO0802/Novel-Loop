import type { TaskStatus } from '../fixtures/types';

export interface PrototypeState {
  activeProjectId: string | null;
  focusMode: boolean;
  assistantPanel: 'goal' | 'diagnostics' | 'candidate' | 'commit' | null;
  activeTaskId: string | null;
  autosave: 'saved' | 'saving' | 'failed';
}

type PrototypeTask = {
  id: string;
  status: TaskStatus;
};

const prototypeTasks: PrototypeTask[] = [
  { id: 'rain-radio-review', status: 'running' }
];

export const defaultPrototypeState: PrototypeState = {
  activeProjectId: 'rain-radio',
  focusMode: false,
  assistantPanel: null,
  activeTaskId: 'rain-radio-review',
  autosave: 'saved'
};

export function getPrototypeTaskStatus(taskId: string | null): TaskStatus | null {
  return prototypeTasks.find((task) => task.id === taskId)?.status ?? null;
}
