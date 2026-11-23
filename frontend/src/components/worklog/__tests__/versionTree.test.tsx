// frontend/src/components/worklog/__tests__/versionTree.test.tsx
// 版本 → 需求树:层级渲染、复制 id、选择回调、计数/关联项目徽标、
// 新建/删除版本与新建需求走弹窗回调、重命名行内编辑、删除需求行内二次确认。
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
  versions: [{
    id: 'v_1', name: 'V8.0.8', createdAt: 1,
    requirements: [{
      id: 'r_1', title: '澳门底层数据建设', projects: ['资源加工平台'], createdAt: 1,
      entries: [{
        id: 'e1', title: 't', detail: 'd', date: '2026-11-23',
        createdAt: 1, updatedAt: 1, project: '资源加工平台',
      }],
    }],
  }, {
    id: 'v_2', name: 'V8.0.7', createdAt: 0, requirements: [],
  }],
};

afterEach(() => {
  cleanup(); // vitest 未开 globals,RTL 不会自动卸载,多次 render 会累积 DOM
});

describe('VersionRequirementTree', () => {
  it('renders version → requirement tree with copyable ids', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('V8.0.8')).toBeTruthy();
    expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
    expect(screen.getByTitle('复制 v_1')).toBeTruthy();
    expect(screen.getByTitle('复制 r_1')).toBeTruthy();
  });

  it('shows requirement / entry counts and related project badge', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText(/1 需求 · 1 条/)).toBeTruthy();
    expect(screen.getByText('资源加工平台')).toBeTruthy();
  });

  it('selects requirement with version + requirement ids', () => {
    const onSelect = vi.fn();
    render(<VersionRequirementTree data={data} selection={{}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('澳门底层数据建设'));
    expect(onSelect).toHaveBeenCalledWith({ versionId: 'v_1', requirementId: 'r_1' });
  });

  it('selects version on row click without collapsing requirements', () => {
    const onSelect = vi.fn();
    render(<VersionRequirementTree data={data} selection={{}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('V8.0.8'));
    expect(onSelect).toHaveBeenCalledWith({ versionId: 'v_1' });
    // 行点击只选择;折叠由独立箭头控制,避免被自动展开 effect 撤销
    expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
  });

  it('collapses and re-expands via the chevron button', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    fireEvent.click(screen.getByLabelText('收起 V8.0.8'));
    expect(screen.queryByText('澳门底层数据建设')).toBeNull();
    fireEvent.click(screen.getByLabelText('展开 V8.0.8'));
    expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
  });

  it('auto-expands a collapsed version when a new requirement is selected', () => {
    const { rerender } = render(
      <VersionRequirementTree data={data} selection={{ versionId: 'v_1' }} onSelect={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText('收起 V8.0.8'));
    expect(screen.queryByText('澳门底层数据建设')).toBeNull();
    // versionId 未变、仅 requirementId 变化(新建需求后选中)也必须展开
    rerender(
      <VersionRequirementTree data={data} selection={{ versionId: 'v_1', requirementId: 'r_1' }} onSelect={() => {}} />,
    );
    expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
  });

  it('sorts versions by name descending with numeric awareness', () => {
    const sortData: WorklogData = {
      projects: [],
      versions: [
        { id: 'v9', name: 'V8.0.9', createdAt: 1, requirements: [] },
        { id: 'v10', name: 'V8.0.10', createdAt: 2, requirements: [] },
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
    fireEvent.click(screen.getByText('新建版本'));
    expect(onCreateVersionClick).toHaveBeenCalledTimes(1);
  });

  it('opens the requirement dialog from the version context menu', () => {
    const onCreateRequirementClick = vi.fn();
    render(
      <VersionRequirementTree
        data={data}
        selection={{}}
        onSelect={() => {}}
        onCreateRequirementClick={onCreateRequirementClick}
      />,
    );
    // 每个版本行都有菜单项,取第一个(版本 v_1)
    fireEvent.click(screen.getAllByText('新建需求')[0]);
    expect(onCreateRequirementClick).toHaveBeenCalledWith('v_1');
  });

  it('renames a version inline', () => {
    const onRenameVersion = vi.fn();
    render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} onRenameVersion={onRenameVersion} />,
    );
    // 版本菜单先于需求菜单渲染,'重命名' 第一处属于版本行
    fireEvent.click(screen.getAllByText('重命名')[0]);
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

  it('requires a second click before deleting a requirement', () => {
    const onDeleteRequirement = vi.fn();
    render(
      <VersionRequirementTree data={data} selection={{}} onSelect={() => {}} onDeleteRequirement={onDeleteRequirement} />,
    );
    fireEvent.click(screen.getAllByText('删除需求')[0]);
    expect(onDeleteRequirement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认'));
    expect(onDeleteRequirement).toHaveBeenCalledWith('v_1', 'r_1');
  });
});
