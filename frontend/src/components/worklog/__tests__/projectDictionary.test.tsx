// frontend/src/components/worklog/__tests__/projectDictionary.test.tsx
// 项目字典(从旧树移出):路径三态(已绑定尾段 / 未绑定 / 路径不存在标红)与路径绑定弹窗交互。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProjectDictionaryDialog } from '../ProjectDictionaryDialog';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import type { WorklogProject } from '@ai-task-flow/shared';

// Dialog 基于 @radix-ui/react-dialog,会解析到根 react@18(双 React),按现有 sheet mock 先例处理。
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
    bindPaths: vi.fn(),
    unbindPath: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

const mockedBind = vi.mocked(worklogApi.bindPaths);
const mockedUnbind = vi.mocked(worklogApi.unbindPath);
const mockedCreate = vi.mocked(worklogApi.createProject);
const mockedRename = vi.mocked(worklogApi.renameProject);
const mockedDelete = vi.mocked(worklogApi.deleteProject);

function project(over: Partial<WorklogProject> = {}): WorklogProject {
  return { id: 'p1', name: '资源加工平台', createdAt: 1, ...over };
}

function renderDialog(projects: WorklogProject[], extra: Record<string, unknown> = {}) {
  const props = { open: true, onOpenChange: vi.fn(), onChanged: vi.fn(), ...extra };
  const view = render(<ProjectDictionaryDialog projects={projects} {...props} />);
  return { ...view, props };
}

describe('ProjectDictionaryDialog 路径三态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBind.mockResolvedValue({ ok: true });
    mockedUnbind.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('should show path tail and unbound state', () => {
    renderDialog([
      project({ paths: ['D:\\xunfei\\资源加工平台'] }),
      project({ id: 'p2', name: '组卷', createdAt: 2 }),
    ]);

    expect(screen.getByText(/xunfei\\资源加工平台/)).toBeInTheDocument();
    expect(screen.getByText('未绑定路径')).toBeInTheDocument();
  });

  it('should append +N suffix when project has multiple paths', () => {
    renderDialog([project({ paths: ['D:\\xunfei\\a', 'D:\\xunfei\\b', 'D:\\xunfei\\c'] })]);
    expect(screen.getByText(/xunfei\\a/)).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('should mark path as missing with red style and title', () => {
    const missing = 'D:\\gone\\repo';
    renderDialog([project({ paths: [missing], missingPaths: [missing] })]);

    const node = screen.getByText(/gone\\repo/);
    expect(node).toHaveAttribute('title', '路径不存在');
    expect(node.className).toContain('text-destructive');
  });

  it('should only red-mark the actually missing path, not the first valid one', () => {
    const valid = 'D:\\xunfei\\a';
    const missing = 'D:\\gone\\b';
    renderDialog([project({ paths: [valid, missing], missingPaths: [missing] })]);

    const first = screen.getByText(/xunfei\\a/);
    expect(first).toHaveAttribute('title', valid);
    expect(first.className).not.toContain('text-destructive');
    expect(screen.queryByText('路径不存在')).not.toBeInTheDocument();
    const missingHint = screen.getByText('1 条失效');
    expect(missingHint.className).toContain('text-destructive');
  });

  it('should keep full path as title when path exists', () => {
    renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);
    expect(screen.getByText(/xunfei\\资源加工平台/)).toHaveAttribute('title', 'D:\\xunfei\\资源加工平台');
  });
});

describe('ProjectPathDialog 路径绑定(经项目字典打开)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBind.mockResolvedValue({ ok: true });
    mockedUnbind.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('should open dialog from project row and save parsed paths', async () => {
    const onChanged = vi.fn();
    renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })], { onChanged });

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
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should confirm before clearing all bindings with an empty textarea', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    fireEvent.change(screen.getByLabelText('项目路径'), { target: { value: '' } });
    fireEvent.click(screen.getByText('保存'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedBind).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mockedBind).toHaveBeenCalledWith('资源加工平台', []));
    confirmSpy.mockRestore();
  });

  it('should unbind a single existing path', async () => {
    const onChanged = vi.fn();
    renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })], { onChanged });

    fireEvent.click(screen.getByText('绑定路径…'));
    fireEvent.click(screen.getByText('解绑'));

    await waitFor(() => expect(mockedUnbind).toHaveBeenCalledWith('资源加工平台', 'D:\\xunfei\\资源加工平台'));
    expect(toast.success).toHaveBeenCalledWith('路径已解绑');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should toast backend error and not refresh on save failure', async () => {
    mockedBind.mockRejectedValueOnce(new Error('路径已被项目「组卷」占用'));
    const onChanged = vi.fn();
    renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })], { onChanged });

    fireEvent.click(screen.getByText('绑定路径…'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('绑定失败:路径已被项目「组卷」占用'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('should keep unsaved input when unbinding an existing path', async () => {
    const view = renderDialog([project({ paths: ['D:\\xunfei\\资源加工平台'] })]);

    fireEvent.click(screen.getByText('绑定路径…'));
    const textarea = screen.getByLabelText('项目路径');
    fireEvent.change(textarea, { target: { value: 'D:\\xunfei\\资源加工平台\nE:\\repo' } });
    fireEvent.click(screen.getByText('解绑'));
    await waitFor(() => expect(mockedUnbind).toHaveBeenCalledTimes(1));

    // 模拟 onChanged → 父组件 refresh 后服务端路径变化:不得覆盖用户未保存的新输入
    view.rerender(<ProjectDictionaryDialog projects={[project({ paths: [] })]} {...view.props} />);

    await waitFor(() => expect(screen.getByLabelText('项目路径')).toHaveValue('E:\\repo'));
  });
});

describe('项目字典 CRUD(新建 / 重命名 / 删除)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreate.mockResolvedValue({ id: 'p_new' });
    mockedRename.mockResolvedValue({ ok: true });
    mockedDelete.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('should create a project with name and optional paths parsed one per line', async () => {
    const onChanged = vi.fn();
    renderDialog([], { onChanged });

    // 空态不再引导「记录时传项目」,改为先新建
    expect(screen.getByText(/先新建项目并可选绑定路径/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('新建项目'));
    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '  资源加工平台  ' } });
    fireEvent.change(screen.getByLabelText('项目路径'), {
      target: { value: 'D:\\xunfei\\资源加工平台\n\nE:\\repo\n' },
    });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith({
      name: '资源加工平台',
      paths: ['D:\\xunfei\\资源加工平台', 'E:\\repo'],
    }));
    expect(toast.success).toHaveBeenCalledWith('项目已创建:资源加工平台');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should omit paths when creating without bound paths', async () => {
    renderDialog([]);
    fireEvent.click(screen.getByText('新建项目'));
    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '组卷' } });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith({ name: '组卷' }));
  });

  it('should toast backend error and not refresh when create fails', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('项目名 "组卷" 已存在'));
    const onChanged = vi.fn();
    renderDialog([], { onChanged });

    fireEvent.click(screen.getByText('新建项目'));
    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '组卷' } });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('新建项目失败:项目名 "组卷" 已存在'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('should rename a project inline and refresh', async () => {
    const onChanged = vi.fn();
    renderDialog([project()], { onChanged });

    fireEvent.click(screen.getByText('重命名'));
    const input = screen.getByLabelText('新项目名');
    expect(input).toHaveValue('资源加工平台');
    fireEvent.change(input, { target: { value: '资源加工平台2' } });
    fireEvent.click(screen.getByLabelText('确认重命名'));

    await waitFor(() => expect(mockedRename).toHaveBeenCalledWith('资源加工平台', '资源加工平台2'));
    expect(toast.success).toHaveBeenCalledWith('项目已重命名为:资源加工平台2');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should toast error and keep editing when rename fails', async () => {
    mockedRename.mockRejectedValueOnce(new Error('项目名 "组卷" 已存在'));
    const onChanged = vi.fn();
    renderDialog([project()], { onChanged });

    fireEvent.click(screen.getByText('重命名'));
    fireEvent.change(screen.getByLabelText('新项目名'), { target: { value: '组卷' } });
    fireEvent.click(screen.getByLabelText('确认重命名'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('重命名失败:项目名 "组卷" 已存在'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByLabelText('新项目名')).toBeInTheDocument(); // 失败保留输入,可改后重试
  });

  it('should require strong confirmation before deleting a project', async () => {
    const onChanged = vi.fn();
    renderDialog([project()], { onChanged });

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    // 强确认文案必须讲清后果
    expect(screen.getByText('只移除字典，历史条目不删除；路径归属将失效。')).toBeInTheDocument();

    fireEvent.click(screen.getByText('取消'));
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByText('确认删除'));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('资源加工平台'));
    expect(toast.success).toHaveBeenCalledWith('项目已删除:资源加工平台');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should toast error and not refresh when delete fails', async () => {
    mockedDelete.mockRejectedValueOnce(new Error('项目 "资源加工平台" 不存在'));
    const onChanged = vi.fn();
    renderDialog([project()], { onChanged });

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByText('确认删除'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      '删除项目失败:项目 "资源加工平台" 不存在',
    ));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
