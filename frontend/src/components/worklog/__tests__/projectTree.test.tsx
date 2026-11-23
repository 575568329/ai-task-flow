// frontend/src/components/worklog/__tests__/projectTree.test.tsx
// 项目树路径三态(已绑定尾段 / 未绑定 / 路径不存在标红)与路径绑定弹窗交互。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProjectVersionTree } from '../ProjectVersionTree';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import type { WorklogData, WorklogProject } from '@ai-task-flow/shared';

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

// Dialog 基于 @radix-ui/react-dialog,同样会解析到根 react@18,按现有 sheet mock 先例处理。
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
  worklogApi: { bindPaths: vi.fn(), unbindPath: vi.fn() },
}));

const mockedBind = vi.mocked(worklogApi.bindPaths);
const mockedUnbind = vi.mocked(worklogApi.unbindPath);

function project(over: Partial<WorklogProject> = {}): WorklogProject {
  return { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [], ...over };
}

function renderTree(projects: WorklogProject[], extra: Record<string, unknown> = {}) {
  const data: WorklogData = { projects };
  const props = {
    selection: {},
    onSelect: vi.fn(),
    onRenameVersion: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteVersion: vi.fn(),
    onDeleteProject: vi.fn(),
    onPathsChanged: vi.fn(),
    ...extra,
  };
  const view = render(<ProjectVersionTree data={data} {...props} />);
  return { props, rerender: view.rerender };
}

describe('ProjectVersionTree 路径三态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBind.mockResolvedValue({ ok: true });
    mockedUnbind.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('should show path tail and unbound state', () => {
    renderTree([
      project({ paths: ['D:\\xunfei\\资源加工平台'] }),
      project({ id: 'p2', name: '组卷', createdAt: 2 }),
    ]);

    expect(screen.getByText(/xunfei\\资源加工平台/)).toBeInTheDocument();
    expect(screen.getByText('未绑定路径')).toBeInTheDocument();
  });

  it('should append +N suffix when project has multiple paths', () => {
    renderTree([
      project({ paths: ['D:\\xunfei\\a', 'D:\\xunfei\\b', 'D:\\xunfei\\c'] }),
    ]);

    expect(screen.getByText(/xunfei\\a/)).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('should mark path as missing with red style and title', () => {
    const missing = 'D:\\gone\\repo';
    renderTree([project({ paths: [missing], missingPaths: [missing] })]);

    const node = screen.getByText(/gone\\repo/);
    expect(node).toHaveAttribute('title', '路径不存在');
    expect(node.className).toContain('text-destructive');
  });

  it('should keep full path as title when path exists', () => {
    renderTree([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    expect(screen.getByText(/xunfei\\资源加工平台/)).toHaveAttribute('title', 'D:\\xunfei\\资源加工平台');
  });
});

describe('ProjectPathDialog 路径绑定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBind.mockResolvedValue({ ok: true });
    mockedUnbind.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('should open dialog from context menu and save parsed paths', async () => {
    const { props } = renderTree([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    const textarea = screen.getByLabelText('项目路径');
    expect(textarea).toHaveValue('D:\\xunfei\\资源加工平台');

    fireEvent.change(textarea, { target: { value: 'D:\\xunfei\\资源加工平台\nE:\\repo' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(mockedBind).toHaveBeenCalledWith(
      '资源加工平台',
      ['D:\\xunfei\\资源加工平台', 'E:\\repo'],
    ));
    expect(toast.success).toHaveBeenCalledWith('路径已绑定');
    expect(props.onPathsChanged).toHaveBeenCalledTimes(1);
  });

  it('should unbind a single existing path', async () => {
    const { props } = renderTree([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    fireEvent.click(screen.getByText('解绑'));

    await waitFor(() => expect(mockedUnbind).toHaveBeenCalledWith('资源加工平台', 'D:\\xunfei\\资源加工平台'));
    expect(toast.success).toHaveBeenCalledWith('路径已解绑');
    expect(props.onPathsChanged).toHaveBeenCalledTimes(1);
  });

  it('should toast backend error and not refresh on save failure', async () => {
    mockedBind.mockRejectedValueOnce(new Error('路径已被项目「组卷」占用'));
    const { props } = renderTree([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('绑定失败:路径已被项目「组卷」占用'));
    expect(props.onPathsChanged).not.toHaveBeenCalled();
  });

  it('should keep unsaved input when unbinding an existing path', async () => {
    const { props, rerender } = renderTree([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    const textarea = screen.getByLabelText('项目路径');
    fireEvent.change(textarea, { target: { value: 'D:\\xunfei\\资源加工平台\nE:\\repo' } });
    fireEvent.click(screen.getByText('解绑'));
    await waitFor(() => expect(mockedUnbind).toHaveBeenCalledTimes(1));

    // 模拟 onChanged → 父组件 refresh 后服务端路径变化:不得覆盖用户未保存的新输入
    rerender(<ProjectVersionTree data={{ projects: [project({ paths: [] })] }} {...props} />);

    await waitFor(() => expect(screen.getByLabelText('项目路径')).toHaveValue('E:\\repo'));
  });
});
