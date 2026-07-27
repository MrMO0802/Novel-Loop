import { describe, expect, test, vi } from 'vitest';

import { registerProjectHandlers } from '../../src/main/ipc/registerProjectHandlers';
import type { ProjectLibraryApplicationService } from '../../src/main/projects/ProjectLibraryService';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type {
  LibraryLocationSelection,
  ProjectLibraryResult,
  ProjectOpenResult
} from '../../src/shared/projectContract';

type ProjectHandler = (
  event: { senderFrame: { url: string } },
  request: unknown
) => Promise<unknown>;

const trustedRendererUrl = 'http://127.0.0.1:5173';
const trustedEvent = {
  senderFrame: { url: `${trustedRendererUrl}/library` }
};
const emptyLibrary: ProjectLibraryResult = {
  projects: [],
  defaultLocation: {
    configured: false,
    locationLabel: null
  },
  warning: null
};
const selectedLibrary: LibraryLocationSelection = {
  selection: 'selected',
  locationLabel: '我的小说'
};
const openedProject: ProjectOpenResult = {
  outcome: 'opened',
  project: {
    projectKey: 'project_0123456789abcdef01234567',
    title: '雾港来信',
    latestCommittedChapter: 0,
    health: 'ready',
    lastOpenedAt: '2026-07-27T01:00:00.000Z',
    briefExcerpt: '来自未来的退信。',
    locationLabel: '我的小说',
    storyBibleAvailable: false,
    globalPlanAvailable: false
  }
};
const createdProject: ProjectOpenResult = {
  ...openedProject,
  outcome: 'created'
};

function createService(): ProjectLibraryApplicationService {
  return {
    list: vi.fn(async () => emptyLibrary),
    chooseDefaultLibrary: vi.fn(async () => selectedLibrary),
    create: vi.fn(async () => createdProject),
    openExisting: vi.fn(async () => openedProject),
    open: vi.fn(async () => openedProject),
    remove: vi.fn(async () => emptyLibrary)
  };
}

function register(service: ProjectLibraryApplicationService) {
  const registrations: Array<{
    channel: string;
    handler: ProjectHandler;
  }> = [];

  registerProjectHandlers(
    {
      handle(channel, handler) {
        registrations.push({ channel, handler });
      }
    },
    service,
    trustedRendererUrl
  );

  const handlerFor = (channel: string): ProjectHandler => {
    const registration = registrations.find((candidate) => (
      candidate.channel === channel
    ));
    if (registration === undefined) {
      throw new Error(`Expected a handler for ${channel}.`);
    }
    return registration.handler;
  };

  return { registrations, handlerFor };
}

describe('project library IPC handlers', () => {
  test('registers each fixed project channel exactly once', () => {
    const { registrations } = register(createService());

    expect(registrations.map(({ channel }) => channel)).toEqual([
      IPC_CHANNELS.projectsList,
      IPC_CHANNELS.projectsChooseDefaultLibrary,
      IPC_CHANNELS.projectsCreate,
      IPC_CHANNELS.projectsOpenExisting,
      IPC_CHANNELS.projectsOpen,
      IPC_CHANNELS.projectsRemove
    ]);
    expect(new Set(registrations.map(({ channel }) => channel)).size).toBe(6);
  });

  test('trusted strict requests call their named service methods', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsList)(
      trustedEvent,
      {}
    )).resolves.toEqual(emptyLibrary);
    await expect(handlerFor(IPC_CHANNELS.projectsChooseDefaultLibrary)(
      trustedEvent,
      {}
    )).resolves.toEqual(selectedLibrary);
    await expect(handlerFor(IPC_CHANNELS.projectsCreate)(
      trustedEvent,
      {
        title: '  雾港来信  ',
        coreIdea: '  来自未来的退信。  ',
        useDifferentLocation: false
      }
    )).resolves.toMatchObject({ outcome: 'created' });
    await expect(handlerFor(IPC_CHANNELS.projectsOpenExisting)(
      trustedEvent,
      {}
    )).resolves.toEqual(openedProject);
    await expect(handlerFor(IPC_CHANNELS.projectsOpen)(
      trustedEvent,
      { projectKey: 'project_0123456789abcdef01234567' }
    )).resolves.toEqual(openedProject);
    await expect(handlerFor(IPC_CHANNELS.projectsRemove)(
      trustedEvent,
      { projectKey: 'project_0123456789abcdef01234567' }
    )).resolves.toEqual(emptyLibrary);

    expect(service.list).toHaveBeenCalledOnce();
    expect(service.chooseDefaultLibrary).toHaveBeenCalledOnce();
    expect(service.create).toHaveBeenCalledWith({
      title: '雾港来信',
      coreIdea: '来自未来的退信。',
      useDifferentLocation: false
    });
    expect(service.openExisting).toHaveBeenCalledOnce();
    expect(service.open).toHaveBeenCalledWith(
      'project_0123456789abcdef01234567'
    );
    expect(service.remove).toHaveBeenCalledWith(
      'project_0123456789abcdef01234567'
    );
  });

  test('rejects unknown request fields before the service call', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsCreate)(
      trustedEvent,
      {
        title: '雾港来信',
        coreIdea: '来自未来的退信。',
        useDifferentLocation: false,
        projectRoot: '/private/path'
      }
    )).rejects.toThrow();
    expect(service.create).not.toHaveBeenCalled();
  });

  test('rejects an untrusted sender before the service call', async () => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsList)(
      { senderFrame: { url: 'https://example.com' } },
      {}
    )).rejects.toThrow('Untrusted renderer request.');
    expect(service.list).not.toHaveBeenCalled();
  });

  test('rejects a service response containing an absolute project root', async () => {
    const service = createService();
    service.list = vi.fn(async () => ({
      ...emptyLibrary,
      projects: [{
        ...openedProject.project,
        projectRoot: '/private/path'
      }]
    }) as unknown as ProjectLibraryResult);
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsList)(
      trustedEvent,
      {}
    )).rejects.toThrow();
  });

  test('rejects a malformed result variant returned by the service', async () => {
    const service = createService();
    service.openExisting = vi.fn(async () => ({
      outcome: 'opened'
    }) as ProjectOpenResult);
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsOpenExisting)(
      trustedEvent,
      {}
    )).rejects.toThrow();
  });

  test.each([
    {
      label: 'blank title',
      request: {
        title: '   ',
        coreIdea: '来自未来的退信。',
        useDifferentLocation: false
      }
    },
    {
      label: 'title over 160 characters',
      request: {
        title: '题'.repeat(161),
        coreIdea: '来自未来的退信。',
        useDifferentLocation: false
      }
    },
    {
      label: 'blank core idea',
      request: {
        title: '雾港来信',
        coreIdea: '   ',
        useDifferentLocation: false
      }
    },
    {
      label: 'core idea over 4000 characters',
      request: {
        title: '雾港来信',
        coreIdea: '信'.repeat(4_001),
        useDifferentLocation: false
      }
    }
  ])('rejects a create request with $label', async ({ request }) => {
    const service = createService();
    const { handlerFor } = register(service);

    await expect(handlerFor(IPC_CHANNELS.projectsCreate)(
      trustedEvent,
      request
    )).rejects.toThrow();
    expect(service.create).not.toHaveBeenCalled();
  });
});
