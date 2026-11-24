// frontend/src/components/worklog/__tests__/programTree.test.tsx
// 四层树(建设主题 → 版本 → 需求):主题行计数/复制 id、折叠、右键新建版本预选主题、
// 重命名/删除主题回调;无主题空态。
// 主题创建弹窗:创建成功后常驻展示可复制的 g_xxx;删除主题:输入主题名强确认。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VersionRequirementTree } from '../VersionRequirementTree';
import { ProgramDialog } from '../ProgramDialog';
import { DeleteProgramDialog } from '../DeleteProgramDialog';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
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

// Dialog 基于 @radix-ui/react-dialog,会解析到根 react@18(双 React),按 versionDialogs.test 先例 mock。
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/api/worklog', () => ({
  worklogApi: {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    deleteProgram: vi.fn(),
  },
}));

const data: WorklogData = {
  projects: [],
  programs: [{ id: 'g_1', name: '澳门底层数据建设', createdAt: 1 }],
  versions: [{
    id: 'v_1', name: 'V8.0.8', programId: 'g_1', createdAt: 1,
    requirements: [{ id: 'r_1', title: '需求A', createdAt: 1, entries: [] }],
  }],
};

const mockedCreateProgram = vi.mocked(worklogApi.createProgram);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateProgram.mockResolvedValue({ id: 'g_new' });
});

afterEach(() => {
  cleanup(); // vitest 未开 globals,RTL 不会自动卸载
});

describe('VersionRequirementTree 建设主题层', () => {
  it('renders program → version → requirement', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
    expect(screen.getByText('V8.0.8')).toBeTruthy();
    expect(screen.getByText('需求A')).toBeTruthy();
  });

  it('shows version count and a copyable program id', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('1 版本')).toBeTruthy();
    expect(screen.getByTitle('复制 g_1')).toBeTruthy();
    expect(screen.getByTitle('复制 v_1')).toBeTruthy();
  });

  it('opens the version dialog from the program context menu with the program preselected', () => {
    const onCreateVersionClick = vi.fn();
    render(
      <VersionRequirementTree
        data={data}
        selection={{}}
        onSelect={() => {}}
        onCreateVersionClick={onCreateVersionClick}
      />,
    );
    // 第一个「新建版本」属于主题行右键菜单(其后才是底部入口)
    fireEvent.click(screen.getAllByText('新建版本')[0]);
    expect(onCreateVersionClick).toHaveBeenCalledWith('g_1');
  });

  it('opens the delete-program dialog from the program context menu', () => {
    const onDeleteProgramClick = vi.fn();
    render(
      <VersionRequirementTree
        data={data}
        selection={{}}
        onSelect={() => {}}
        onDeleteProgramClick={onDeleteProgramClick}
      />,
    );
    fireEvent.click(screen.getByText('删除主题'));
    expect(onDeleteProgramClick).toHaveBeenCalledWith('g_1');
  });

  it('renames a program inline', () => {
    const onRenameProgram = vi.fn();
    render(
      <VersionRequirementTree
        data={data}
        selection={{}}
        onSelect={() => {}}
        onRenameProgram={onRenameProgram}
      />,
    );
    fireEvent.click(screen.getAllByText('重命名')[0]);
    const input = screen.getByLabelText('新主题名');
    expect(input).toHaveValue('澳门底层数据建设');
    fireEvent.change(input, { target: { value: '澳门数据二期' } });
    fireEvent.click(screen.getByLabelText('确认'));
    expect(onRenameProgram).toHaveBeenCalledWith('g_1', '澳门数据二期');
  });

  it('collapses and re-expands versions under a program', () => {
    render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
    fireEvent.click(screen.getByLabelText('收起 澳门底层数据建设'));
    expect(screen.queryByText('V8.0.8')).toBeNull();
    expect(screen.queryByText('需求A')).toBeNull();
    fireEvent.click(screen.getByLabelText('展开 澳门底层数据建设'));
    expect(screen.getByText('V8.0.8')).toBeTruthy();
  });

  it('shows the no-program empty state', () => {
    const empty: WorklogData = { projects: [], programs: [], versions: [] };
    render(<VersionRequirementTree data={empty} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('还没有建设主题。先新建主题，再建版本与需求。')).toBeTruthy();
  });

  it('keeps dangling versions visible under an unassigned group', () => {
    const dangling: WorklogData = {
      projects: [],
      programs: [],
      versions: [{ id: 'v_x', name: 'V0.0.1', programId: 'g_gone', createdAt: 1, requirements: [] }],
    };
    render(<VersionRequirementTree data={dangling} selection={{}} onSelect={() => {}} />);
    expect(screen.getByText('未归属主题')).toBeTruthy();
    expect(screen.getByText('V0.0.1')).toBeTruthy();
  });
});

describe('ProgramDialog', () => {
  it('creates a program and shows a copyable id', async () => {
    const onCreated = vi.fn();
    render(<ProgramDialog open onClose={() => {}} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('主题名'), { target: { value: ' 澳门底层数据建设 ' } });
    fireEvent.change(screen.getByLabelText('描述(可选)'), { target: { value: '底层数据' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('g_new')).toBeTruthy();
    expect(screen.getByTitle('复制 g_new')).toBeTruthy();
    expect(mockedCreateProgram).toHaveBeenCalledWith({
      name: '澳门底层数据建设',
      description: '底层数据',
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 'g_new', name: '澳门底层数据建设' });
    expect(toast.success).toHaveBeenCalledWith('主题已创建:澳门底层数据建设');
  });

  it('disables create until a non-blank name is entered', () => {
    render(<ProgramDialog open onClose={() => {}} />);
    const create = screen.getByRole('button', { name: '创建' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('主题名'), { target: { value: '   ' } });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('主题名'), { target: { value: '澳门建设' } });
    expect(create).toBeEnabled();
  });
});

describe('DeleteProgramDialog', () => {
  it('explains the cascade and requires typing the exact program name', () => {
    render(<DeleteProgramDialog open programName="澳门底层数据建设" onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/级联移除该主题下的全部版本、需求与条目/)).toBeTruthy();
    expect(screen.getByText(/项目字典不受影响/)).toBeTruthy();

    const confirm = screen.getByRole('button', { name: '确认删除' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入主题名确认'), { target: { value: '别的主题' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入主题名确认'), { target: { value: ' 澳门底层数据建设 ' } });
    expect(confirm).toBeEnabled();
  });

  it('calls onConfirm then closes on confirmed delete', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<DeleteProgramDialog open programName="澳门底层数据建设" onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText('输入主题名确认'), { target: { value: '澳门底层数据建设' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open and toasts when delete fails', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('主题不存在'); });
    const onClose = vi.fn();
    render(<DeleteProgramDialog open programName="澳门底层数据建设" onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText('输入主题名确认'), { target: { value: '澳门底层数据建设' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('删除主题失败:主题不存在'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
