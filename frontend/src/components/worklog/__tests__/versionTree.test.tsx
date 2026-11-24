// frontend/src/components/worklog/__tests__/versionTree.test.tsx
// 主题 → 版本树:层级渲染、复制 id、选择回调、条目计数、
// 新建/删除版本走弹窗回调、重命名行内编辑。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VersionRequirementTree } from '../VersionRequirementTree';
import type { WorklogData } from '@ai-task-flow/shared';

// 右键菜单基于 radix-ui(monorepo 根 node_modules 与根 react@18 同层,双 React),
// 交互测试只关心菜单项回调,这里 mock 为原生结构。
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, onSelect }: { children?: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const data: WorklogData = {
  projects: [{ id: 'p1', name: '资源加工平台', createdAt: 1 }],
  programs: [{ id: 'g_1', name: '建设主题A', createdAt: 1 }],
  versions: [{
    id: 'v_1', name: 'V8.0.8', programId: 'g_1', createdAt: 1,
    entries: [{
      id: 'e1', title: 't', detail: 'd', date: '2026-11-23',
      createdAt: 1, updatedAt: 1, project: '资源加工平台',
    }],
  }, {
    id: 'v_2', name: 'V8.0.7', programId: 'g_1', createdAt: 0, entries: [],
  }],
};

afterEach(() => {
  cleanup(); // vitest 未开 globals,RTL 不会自动卸载,多次 render 会累积 DOM
});

describe('VersionRequirementTree', () => {
  it('renders program → version tree with copyable ids', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('建设主题A')).toBeTruthy();
    expect(screen.getByText('V8.0.8')).toBeTruthy();
    expect(screen.getByTitle('复制 g_1')).toBeTruthy();
    expect(screen.getByTitle('复制 v_1')).toBeTruthy();
  });

  it('shows entry counts per version', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('1 条')).toBeTruthy();
    expect(screen.getByText('0 条')).toBeTruthy();
    expect(screen.getByText('2 版本')).toBeTruthy();
  });

  it('selects a version on row click', () => {
    const onSelect = vi.fn();
    render(<VersionRequirementTree data={data} selection={{}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('V8.0.8'));
    expect(onSelect).toHaveBeenCalledWith({ versionId: 'v_1' });
  });

  it('auto-expands a collapsed program when selection points into it after refresh', () => {
    const { rerender } = render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText('收起 建设主题A'));
    expect(screen.queryByText('V8.0.8')).toBeNull();

    // 模拟 refresh:data 换新对象,selection 指向该主题内的版本
    const refreshed: WorklogData = {
      ...data,
      programs: data.programs.map((p) => ({ ...p })),
      versions: data.versions.map((v) => ({ ...v })),
    };
    rerender(
      <VersionRequirementTree data={refreshed} selection={{ versionId: 'v_1' }} onSelect={() => {}} />,
    );
    expect(screen.getByText('V8.0.8')).toBeTruthy();
  });

  it('sorts versions by name descending with numeric awareness', () => {
    const sortData: WorklogData = {
      projects: [],
      programs: [{ id: 'g_1', name: '主题', createdAt: 1 }],
      versions: [
        { id: 'v9', name: 'V8.0.9', programId: 'g_1', createdAt: 1, entries: [] },
        { id: 'v10', name: 'V8.0.10', programId: 'g_1', createdAt: 2, entries: [] },
      ],
    };
    render(<VersionRequirementTree data={sortData} selection={{}} onSelect={() => {}} />);
    const names = screen.getAllByText(/^V8\.0\.\d+$/).map((el) => el.textContent);
    expect(names).toEqual(['V8.0.10', 'V8.0.9']);
  });

  it('opens the version dialog from the bottom entry', () => {
    const onCreateVersionClick = vi.fn();
    render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} onCreateVersionClick={onCreateVersionClick} />,
    );
    // 主题右键菜单也有「新建版本」,底部入口是最后一个
    fireEvent.click(screen.getAllByText('新建版本').at(-1)!);
    expect(onCreateVersionClick).toHaveBeenCalledTimes(1);
    expect(onCreateVersionClick).toHaveBeenCalledWith();
  });

  it('renames a version inline', () => {
    const onRenameVersion = vi.fn();
    render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} onRenameVersion={onRenameVersion} />,
    );
    // 渲染顺序:主题菜单 → 版本菜单;'重命名' 第二处属于版本行
    fireEvent.click(screen.getAllByText('重命名')[1]);
    const input = screen.getByLabelText('新版本名');
    expect(input).toHaveValue('V8.0.8');
    fireEvent.change(input, { target: { value: 'V8.0.10' } });
    fireEvent.click(screen.getByLabelText('确认'));
    expect(onRenameVersion).toHaveBeenCalledWith('v_1', 'V8.0.10');
  });

  it('opens the delete-version dialog from the version context menu', () => {
    const onDeleteVersionClick = vi.fn();
    render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} onDeleteVersionClick={onDeleteVersionClick} />,
    );
    fireEvent.click(screen.getAllByText('删除版本')[0]);
    expect(onDeleteVersionClick).toHaveBeenCalledWith('v_1');
  });

  it('shows load-failed hint instead of empty state when tree fetch failed', () => {
    const empty: WorklogData = { projects: [], programs: [], versions: [] };
    render(<VersionRequirementTree data={empty} selection={{}} onSelect={() => {}} loadFailed />);
    expect(screen.getByText('加载失败，请刷新重试。')).toBeTruthy();
    expect(screen.queryByText(/还没有建设主题/)).toBeNull();
  });

  it('shows the normal empty state when load succeeded with no programs', () => {
    const empty: WorklogData = { projects: [], programs: [], versions: [] };
    render(<VersionRequirementTree data={empty} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText(/还没有建设主题。先新建主题，再建版本。/)).toBeTruthy();
    expect(screen.queryByText(/加载失败/)).toBeNull();
  });
});
