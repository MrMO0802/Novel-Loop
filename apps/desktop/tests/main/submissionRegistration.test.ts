import { expect, test, vi } from 'vitest';
import type { ProjectChapterServiceDependencies } from '../../src/main/chapter/ProjectChapterService';
import type { ProjectSubmissionServiceDependencies } from '../../src/main/submission/ProjectSubmissionService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';

const wiring = vi.hoisted(() => ({
  chapter: undefined as ProjectChapterServiceDependencies | undefined,
  submission: undefined as ProjectSubmissionServiceDependencies | undefined,
  handle: vi.fn()
}));

vi.mock('electron', () => ({
  app: {
    enableSandbox: vi.fn(), requestSingleInstanceLock: () => true, quit: vi.fn(), on: vi.fn(),
    whenReady: () => Promise.resolve(), getVersion: () => '0.1.0', getPath: () => '/unused-test-user-data'
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: wiring.handle }, dialog: {},
  session: { defaultSession: { setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), setPermissionRequestHandler: vi.fn() } }
}));
vi.mock('../../src/main/createMainWindow', () => ({ createMainWindow: vi.fn() }));
vi.mock('../../src/main/chapter/ProjectChapterService', () => ({
  ProjectChapterService: class { constructor(input: ProjectChapterServiceDependencies) { wiring.chapter = input; } }
}));
vi.mock('../../src/main/submission/ProjectSubmissionService', () => ({
  ProjectSubmissionService: class { constructor(input: ProjectSubmissionServiceDependencies) { wiring.submission = input; } }
}));

test('main registers all submission handlers with the same working-copy store and guard as chapter editing', async () => {
  await import('../../src/main/index');
  await vi.waitFor(() => expect(wiring.submission).toBeDefined());
  expect(wiring.submission?.guard).toBe(wiring.chapter?.submissionGuard);
  expect(wiring.submission?.workingCopies).toBe(wiring.chapter?.workingCopies);
  expect(wiring.submission?.projects).toBe(wiring.chapter?.projects);
  const registered = wiring.handle.mock.calls.map(call => call[0]);
  for (const channel of [IPC_CHANNELS.submissionStartCheck, IPC_CHANNELS.submissionGet, IPC_CHANNELS.submissionCancel, IPC_CHANNELS.submissionReadPreview, IPC_CHANNELS.submissionConfirm]) {
    expect(registered.filter(value => value === channel)).toHaveLength(1);
  }
});
