// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import {
  CreateProjectView
} from '../../src/renderer/src/features/projects/CreateProjectView';
import {
  ProjectLibrary
} from '../../src/renderer/src/features/projects/ProjectLibrary';
import type { NovelLoopDesktopApi } from '../../src/shared/desktopApi';
import type {
  ProjectLibraryResult,
  ProjectOpenResult,
  ProjectSummary
} from '../../src/shared/projectContract';
import type { SystemReadiness } from '../../src/shared/systemContract';

const readyReadiness: SystemReadiness = {
  app: {
    name: 'Novel Loop',
    platform: 'linux',
    version: '0.1.0'
  },
  checkedAt: '2026-07-27T03:00:00.000Z',
  codex: {
    canRunSmoke: true,
    status: 'ready',
    summary: '本地 Codex 已准备好。',
    version: 'codex-cli 1.2.3'
  }
};

const readyProject: ProjectSummary = {
  projectKey: 'project_mist_harbor',
  title: '雾港来信',
  latestCommittedChapter: 0,
  health: 'ready',
  lastOpenedAt: '2026-07-27T08:30:00.000Z',
  briefExcerpt: '一名夜班邮差收到来自未来的退信。',
  locationLabel: '我的小说',
  storyBibleAvailable: false,
  globalPlanAvailable: false
};

const emptyLibrary: ProjectLibraryResult = {
  projects: [],
  defaultLocation: {
    configured: false,
    locationLabel: null
  },
  warning: null
};

const baseStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/base.css'),
  'utf8'
);
const projectLibraryStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/project-library.css'),
  'utf8'
);

type ProjectApiMock = {
  [Key in keyof NovelLoopDesktopApi['projects']]: ReturnType<typeof vi.fn<
    NovelLoopDesktopApi['projects'][Key]
  >>;
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'novelLoop');
});

function installProjectApi(
  library: ProjectLibraryResult = emptyLibrary
): ProjectApiMock {
  const projects: ProjectApiMock = {
    list: vi.fn<NovelLoopDesktopApi['projects']['list']>()
      .mockResolvedValue(library),
    chooseDefaultLibrary:
      vi.fn<NovelLoopDesktopApi['projects']['chooseDefaultLibrary']>()
        .mockResolvedValue({ selection: 'cancelled' }),
    create: vi.fn<NovelLoopDesktopApi['projects']['create']>()
      .mockResolvedValue({ outcome: 'cancelled' }),
    openExisting: vi.fn<NovelLoopDesktopApi['projects']['openExisting']>()
      .mockResolvedValue({ outcome: 'cancelled' }),
    open: vi.fn<NovelLoopDesktopApi['projects']['open']>()
      .mockResolvedValue({ outcome: 'cancelled' }),
    remove: vi.fn<NovelLoopDesktopApi['projects']['remove']>()
      .mockResolvedValue(library)
  };

  Object.defineProperty(window, 'novelLoop', {
    configurable: true,
    value: {
      system: {
        getReadiness: vi.fn().mockResolvedValue(readyReadiness)
      },
      projects
    } satisfies NovelLoopDesktopApi
  });

  return projects;
}

async function enterProjectLibrary() {
  expect(await screen.findByRole('heading', {
    name: '本地创作环境已准备好'
  })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '进入作品库' }));
  expect(await screen.findByRole('heading', {
    level: 1,
    name: '作品库'
  })).toBeVisible();
}

async function openCreateForm() {
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', { name: '新建小说' }));
  expect(await screen.findByRole('heading', {
    level: 1,
    name: '新建小说'
  })).toBeVisible();
}

async function submitCreateForm({
  coreIdea,
  title,
  useDifferentLocation = false
}: {
  coreIdea: string;
  title: string;
  useDifferentLocation?: boolean;
}) {
  await openCreateForm();
  fireEvent.change(screen.getByLabelText('作品名'), {
    target: { value: title }
  });
  fireEvent.change(screen.getByLabelText('核心构想'), {
    target: { value: coreIdea }
  });
  if (useDifferentLocation) {
    fireEvent.click(screen.getByRole('checkbox', {
      name: '为这部小说选择其他保存位置'
    }));
  }
  fireEvent.click(screen.getByRole('button', { name: '创建小说' }));
}

test('empty library offers real create and open commands', async () => {
  installProjectApi();
  render(<App />);
  await enterProjectLibrary();

  expect(screen.getByRole('button', { name: '新建小说' })).toBeEnabled();
  expect(screen.getByRole('button', {
    name: '打开已有项目'
  })).toBeEnabled();
});

test('creates a project after selecting the first default library', async () => {
  const projectApi = installProjectApi();
  projectApi.chooseDefaultLibrary.mockResolvedValue({
    selection: 'selected',
    locationLabel: '我的小说'
  });
  projectApi.create
    .mockResolvedValueOnce({ outcome: 'location_required' })
    .mockResolvedValueOnce({
      outcome: 'created',
      project: readyProject
    });

  render(<App />);
  await submitCreateForm({
    title: '雾港来信',
    coreIdea: '一名夜班邮差收到来自未来的退信。'
  });

  expect(await screen.findByRole('heading', {
    name: '雾港来信'
  })).toBeVisible();
  expect(projectApi.chooseDefaultLibrary).toHaveBeenCalledOnce();
  expect(projectApi.create).toHaveBeenCalledTimes(2);
});

test('opens a valid existing project and enters overview', async () => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue({
    outcome: 'opened',
    project: readyProject
  });

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  expect(await screen.findByText('尚未提交')).toBeVisible();
});

test('invalid project uses author language and renders no path', async () => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue({
    outcome: 'invalid_project'
  });

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '所选文件夹不是可识别的 Novel Loop 项目'
  );
  expect(document.body).not.toHaveTextContent(/\/home\/|projectRoot|json/i);
});

test('requires a title and core idea before creation', async () => {
  const projectApi = installProjectApi();
  render(<App />);
  await openCreateForm();

  fireEvent.click(screen.getByRole('button', { name: '创建小说' }));

  expect(screen.getByRole('alert')).toHaveTextContent('请填写作品名');
  expect(screen.getByRole('alert')).toHaveTextContent('请写下核心构想');
  expect(projectApi.create).not.toHaveBeenCalled();
});

test('a cancelled existing-project dialog leaves the library unchanged', async () => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue({ outcome: 'cancelled' });

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  expect(await screen.findByRole('heading', {
    level: 1,
    name: '作品库'
  })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(projectApi.list).toHaveBeenCalledOnce();
});

test('the alternate-location checkbox reaches the create API', async () => {
  const projectApi = installProjectApi();
  projectApi.create.mockResolvedValue({
    outcome: 'created',
    project: readyProject
  });

  render(<App />);
  await submitCreateForm({
    title: '雾港来信',
    coreIdea: '一名夜班邮差收到来自未来的退信。',
    useDifferentLocation: true
  });

  expect(projectApi.create).toHaveBeenCalledWith({
    title: '雾港来信',
    coreIdea: '一名夜班邮差收到来自未来的退信。',
    useDifferentLocation: true
  });
  expect(await screen.findByRole('heading', {
    name: '雾港来信'
  })).toBeVisible();
});

test('does not complete creation after the create view unmounts', async () => {
  const projectApi = installProjectApi();
  let resolveCreate: (result: ProjectOpenResult) => void = () => {};
  projectApi.create.mockReturnValue(new Promise((resolve) => {
    resolveCreate = resolve;
  }));
  const onCreated = vi.fn();
  const view = render(
    <CreateProjectView onCancel={vi.fn()} onCreated={onCreated} />
  );
  fireEvent.change(screen.getByLabelText('作品名'), {
    target: { value: '雾港来信' }
  });
  fireEvent.change(screen.getByLabelText('核心构想'), {
    target: { value: '一名夜班邮差收到来自未来的退信。' }
  });
  fireEvent.click(screen.getByRole('button', { name: '创建小说' }));
  expect(projectApi.create).toHaveBeenCalledOnce();

  view.unmount();
  await act(async () => {
    resolveCreate({
      outcome: 'created',
      project: readyProject
    });
  });

  expect(onCreated).not.toHaveBeenCalled();
});

test('does not navigate when an existing-project result arrives after unmount', async () => {
  const projectApi = installProjectApi();
  let resolveOpen: (result: ProjectOpenResult) => void = () => {};
  projectApi.openExisting.mockReturnValue(new Promise((resolve) => {
    resolveOpen = resolve;
  }));
  const onOpenProject = vi.fn();
  const view = render(
    <ProjectLibrary
      onBack={vi.fn()}
      onCreate={vi.fn()}
      onOpenProject={onOpenProject}
    />
  );
  fireEvent.click(await screen.findByRole('button', {
    name: '打开已有项目'
  }));

  view.unmount();
  await act(async () => {
    resolveOpen({
      outcome: 'opened',
      project: readyProject
    });
  });

  expect(onOpenProject).not.toHaveBeenCalled();
});

test('does not navigate when a recent-project result arrives after unmount', async () => {
  const projectApi = installProjectApi({
    ...emptyLibrary,
    projects: [readyProject]
  });
  let resolveOpen: (result: ProjectOpenResult) => void = () => {};
  projectApi.open.mockReturnValue(new Promise((resolve) => {
    resolveOpen = resolve;
  }));
  const onOpenProject = vi.fn();
  const view = render(
    <ProjectLibrary
      onBack={vi.fn()}
      onCreate={vi.fn()}
      onOpenProject={onOpenProject}
    />
  );
  fireEvent.click(await screen.findByRole('button', {
    name: '打开《雾港来信》'
  }));

  view.unmount();
  await act(async () => {
    resolveOpen({
      outcome: 'opened',
      project: readyProject
    });
  });

  expect(onOpenProject).not.toHaveBeenCalled();
});

test('locks library navigation and project actions while an open is pending', async () => {
  const secondProject: ProjectSummary = {
    ...readyProject,
    projectKey: 'project_snow_line',
    title: '雪线以南'
  };
  const projectApi = installProjectApi({
    ...emptyLibrary,
    projects: [readyProject, secondProject]
  });
  let resolveOpen: (result: ProjectOpenResult) => void = () => {};
  projectApi.open.mockReturnValue(new Promise((resolve) => {
    resolveOpen = resolve;
  }));

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开《雾港来信》'
  }));

  expect(screen.getByRole('button', { name: '返回环境检查' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '新建小说' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '打开已有项目' })).toBeDisabled();
  expect(screen.getByRole('button', {
    name: '打开《雪线以南》'
  })).toBeDisabled();
  screen.getAllByRole('button', {
    name: /从最近项目中移除/
  }).forEach((button) => expect(button).toBeDisabled());

  await act(async () => {
    resolveOpen({ outcome: 'cancelled' });
  });
  expect(screen.getByRole('button', {
    name: '返回环境检查'
  })).toBeEnabled();
});

test('sorts recent projects by last opened time and reopens one', async () => {
  const olderProject: ProjectSummary = {
    ...readyProject,
    projectKey: 'project_older',
    title: '北岸旧事',
    lastOpenedAt: '2026-07-25T08:30:00.000Z'
  };
  const newerProject: ProjectSummary = {
    ...readyProject,
    projectKey: 'project_newer',
    title: '雪线以南',
    lastOpenedAt: '2026-07-28T08:30:00.000Z'
  };
  const projectApi = installProjectApi({
    ...emptyLibrary,
    projects: [olderProject, newerProject]
  });
  projectApi.open.mockResolvedValue({
    outcome: 'opened',
    project: olderProject
  });

  render(<App />);
  await enterProjectLibrary();

  const list = screen.getByRole('list', { name: '最近项目' });
  expect(within(list).getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent)).toEqual(['雪线以南', '北岸旧事']);

  fireEvent.click(within(list).getByRole('button', {
    name: '打开《北岸旧事》'
  }));
  expect(projectApi.open).toHaveBeenCalledWith('project_older');
  expect(await screen.findByRole('heading', {
    level: 1,
    name: '北岸旧事'
  })).toBeVisible();
});

test('shows needs-attention health with text as well as an icon', async () => {
  installProjectApi({
    ...emptyLibrary,
    projects: [{
      ...readyProject,
      health: 'needs_attention'
    }]
  });

  render(<App />);
  await enterProjectLibrary();

  expect(screen.getByText('需要检查')).toBeVisible();
});

test('removal explains file retention and calls only projects.remove', async () => {
  const projectApi = installProjectApi({
    ...emptyLibrary,
    projects: [readyProject]
  });
  projectApi.remove.mockResolvedValue(emptyLibrary);

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '从最近项目中移除《雾港来信》'
  }));

  const dialog = screen.getByRole('dialog', { name: '移除最近项目' });
  expect(dialog).toHaveTextContent('项目文件会保留在原位置，不会被删除');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));

  expect(projectApi.remove).toHaveBeenCalledWith('project_mist_harbor');
  expect(projectApi.open).not.toHaveBeenCalled();
  expect(projectApi.openExisting).not.toHaveBeenCalled();
  expect(projectApi.create).not.toHaveBeenCalled();
  expect(await screen.findByText('还没有添加小说项目')).toBeVisible();
});

test('remove dialog traps focus, closes with Escape, and restores its trigger', async () => {
  installProjectApi({
    ...emptyLibrary,
    projects: [readyProject]
  });

  render(<App />);
  await enterProjectLibrary();
  const trigger = screen.getByRole('button', {
    name: '从最近项目中移除《雾港来信》'
  });
  fireEvent.click(trigger);

  const dialog = screen.getByRole('dialog', { name: '移除最近项目' });
  const cancel = within(dialog).getByRole('button', { name: '取消' });
  const confirm = within(dialog).getByRole('button', { name: '确认移除' });
  expect(cancel).toHaveFocus();
  expect(screen.getByRole('banner', { hidden: true })).toHaveAttribute('inert');
  expect(document.querySelector('.nl-project-content')).toHaveAttribute(
    'inert'
  );

  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(confirm, { key: 'Tab' });
  expect(cancel).toHaveFocus();

  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', {
    name: '移除最近项目'
  })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('remove failure stays in the dialog and can be retried', async () => {
  const projectApi = installProjectApi({
    ...emptyLibrary,
    projects: [readyProject]
  });
  projectApi.remove
    .mockRejectedValueOnce(new Error('remove failed at /home/private'))
    .mockResolvedValueOnce(emptyLibrary);

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '从最近项目中移除《雾港来信》'
  }));

  const dialog = screen.getByRole('dialog', { name: '移除最近项目' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '暂时无法完成操作，请稍后重试'
  );
  expect(dialog).not.toHaveTextContent(/remove failed|\/home\/private/i);
  const retry = within(dialog).getByRole('button', { name: '确认移除' });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);

  expect(projectApi.remove).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('还没有添加小说项目')).toBeVisible();
});

test('overview shows story-foundation and global-planning availability', async () => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue({
    outcome: 'opened',
    project: {
      ...readyProject,
      storyBibleAvailable: true,
      globalPlanAvailable: false
    }
  });

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  expect(await screen.findByText('已准备')).toBeVisible();
  expect(screen.getByText('尚未准备')).toBeVisible();
});

test('overview generation command is explicitly unavailable', async () => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue({
    outcome: 'opened',
    project: readyProject
  });

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  const action = await screen.findByRole('button', {
    name: '准备生成故事基础'
  });
  expect(action).toBeDisabled();
  expect(screen.getByText('故事基础生成将在下一阶段开放')).toBeVisible();
});

test('keyboard focus moves to each new view heading', async () => {
  const projectApi = installProjectApi();
  projectApi.create.mockResolvedValue({
    outcome: 'created',
    project: readyProject
  });

  render(<App />);
  await enterProjectLibrary();
  expect(screen.getByRole('heading', {
    level: 1,
    name: '作品库'
  })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: '新建小说' }));
  expect(await screen.findByRole('heading', {
    level: 1,
    name: '新建小说'
  })).toHaveFocus();

  fireEvent.change(screen.getByLabelText('作品名'), {
    target: { value: '雾港来信' }
  });
  fireEvent.change(screen.getByLabelText('核心构想'), {
    target: { value: '一名夜班邮差收到来自未来的退信。' }
  });
  fireEvent.click(screen.getByRole('button', { name: '创建小说' }));

  expect(await screen.findByRole('heading', {
    level: 1,
    name: '雾港来信'
  })).toHaveFocus();
});

test('project library exposes loading and recoverable retry states', async () => {
  const projectApi = installProjectApi();
  projectApi.list
    .mockRejectedValueOnce(new Error('registry failed at /home/private'))
    .mockResolvedValueOnce(emptyLibrary);

  render(<App />);
  expect(await screen.findByRole('heading', {
    name: '本地创作环境已准备好'
  })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '进入作品库' }));

  expect(screen.getByRole('status')).toHaveTextContent('正在读取作品库');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '暂时无法读取作品库，请重试'
  );
  expect(document.body).not.toHaveTextContent(/registry failed|\/home\/private/i);

  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(await screen.findByRole('button', { name: '新建小说' })).toBeEnabled();
  expect(projectApi.list).toHaveBeenCalledTimes(2);
});

test.each<{
  message: string;
  result: ProjectOpenResult;
}>([
  {
    message: '无法使用这个保存位置，请重新选择',
    result: { outcome: 'location_unavailable' }
  },
  {
    message: '暂时无法完成操作，请稍后重试',
    result: { outcome: 'failed' }
  },
  {
    message: '这个保存位置已经存在项目，请更换位置后重试',
    result: { outcome: 'project_exists' }
  }
])('maps $result.outcome to fixed author language', async ({
  message,
  result
}) => {
  const projectApi = installProjectApi();
  projectApi.openExisting.mockResolvedValue(result);

  render(<App />);
  await enterProjectLibrary();
  fireEvent.click(screen.getByRole('button', {
    name: '打开已有项目'
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
});

test('maps a registry warning to fixed author language', async () => {
  installProjectApi({
    ...emptyLibrary,
    warning: 'registry_unavailable'
  });

  render(<App />);
  await enterProjectLibrary();

  expect(screen.getByRole('alert')).toHaveTextContent(
    '最近项目记录暂时无法读取，你仍可新建或打开项目'
  );
});

test('uses a solid high-contrast focus indicator', () => {
  expect(baseStyles).not.toContain('rgb(40 95 75 / 28%)');
  expect(projectLibraryStyles).not.toContain('rgb(40 95 75 / 28%)');
  expect(baseStyles).toContain('outline: 3px solid #1e4c3b;');
  expect(projectLibraryStyles).toContain('outline: 3px solid #1e4c3b;');
});
