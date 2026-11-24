// frontend/src/components/worklog/__tests__/versionDialogs.test.tsx
// 版本弹窗:创建成功后常驻展示可复制 id、删除版本需输入版本名强确认。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VersionDialog } from '../VersionDialog';
import { DeleteVersionDialog } from '../DeleteVersionDialog';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import type { WorklogProgram } from '@ai-task-flow/shared';

// Dialog 基于 @radix-ui/react-dialog,会解析到根 react@18(双 React),按 projectDictionary.test 先例 mock。
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
    createVersion: vi.fn(),
    deleteVersion: vi.fn(),
  },
}));

const mockedCreateVersion = vi.mocked(worklogApi.createVersion);

const programs: WorklogProgram[] = [
  { id: 'g_1', name: '澳门底层数据建设', createdAt: 1 },
  { id: 'g_2', name: '题库升级', createdAt: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateVersion.mockResolvedValue({ id: 'v_new' });
});

afterEach(() => {
  cleanup(); // vitest 未开 globals,RTL 不会自动卸载
});

describe('VersionDialog', () => {
  it('creates a version under the preselected program and shows a copyable id', async () => {
    const onCreated = vi.fn();
    render(
      <VersionDialog open programs={programs} defaultProgramId="g_1" onClose={() => {}} onCreated={onCreated} />,
    );

    expect(screen.getByLabelText('所属主题')).toHaveValue('g_1');
    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: ' V8.0.9 ' } });
    fireEvent.change(screen.getByLabelText('描述(可选)'), { target: { value: '第八版' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('v_new')).toBeTruthy();
    expect(screen.getByTitle('复制 v_new')).toBeTruthy();
    expect(mockedCreateVersion).toHaveBeenCalledWith({
      name: 'V8.0.9',
      programId: 'g_1',
      description: '第八版',
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 'v_new', name: 'V8.0.9' });
    expect(toast.success).toHaveBeenCalledWith('版本已创建:V8.0.9');
  });

  it('requires both a program and a non-blank name to create', () => {
    render(<VersionDialog open programs={programs} onClose={() => {}} />);
    const create = screen.getByRole('button', { name: '创建' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: 'V8.0.9' } });
    expect(create).toBeDisabled(); // 主题未选

    fireEvent.change(screen.getByLabelText('所属主题'), { target: { value: 'g_2' } });
    expect(create).toBeEnabled();

    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: '   ' } });
    expect(create).toBeDisabled();
  });

  it('auto-selects the only program when none is passed explicitly', () => {
    render(<VersionDialog open programs={[programs[0]]} onClose={() => {}} />);
    expect(screen.getByLabelText('所属主题')).toHaveValue('g_1');
  });

  it('toasts backend error and keeps the form when creation fails', async () => {
    mockedCreateVersion.mockRejectedValueOnce(new Error('版本已存在'));
    render(<VersionDialog open programs={programs} defaultProgramId="g_1" onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: 'V8.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('创建版本失败:版本已存在'));
    expect(screen.queryByText('v_new')).toBeNull();
    expect(screen.getByLabelText('版本名')).toHaveValue('V8.0.9');
  });

  it('separates refresh failure from create failure after the version is created', async () => {
    const onCreated = vi.fn(async () => { throw new Error('refresh failed'); });
    render(
      <VersionDialog open programs={programs} defaultProgramId="g_1" onClose={() => {}} onCreated={onCreated} />,
    );

    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: 'V8.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    // 版本已创建:成功态与 id 仍要展示,只提示刷新失败
    expect(await screen.findByText('v_new')).toBeTruthy();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('版本已创建,但列表刷新失败,请手动刷新'));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('创建版本失败'));
    expect(mockedCreateVersion).toHaveBeenCalledTimes(1);
  });

  it('keeps the created id visible when programs refresh with a new array reference', async () => {
    const { rerender } = render(
      <VersionDialog open programs={programs} defaultProgramId="g_1" onClose={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: 'V8.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('v_new')).toBeTruthy();

    // 父组件 refresh 后 data.programs 是新数组:不得把成功态(可复制 id)重置掉
    rerender(
      <VersionDialog open programs={programs.map((p) => ({ ...p }))} defaultProgramId="g_1" onClose={() => {}} />,
    );
    expect(screen.getByText('v_new')).toBeTruthy();
    expect(screen.getByTitle('复制 v_new')).toBeTruthy();
  });
});

describe('DeleteVersionDialog', () => {
  it('requires typing the exact version name before delete', () => {
    render(<DeleteVersionDialog open versionName="V8.0.8" onClose={() => {}} onConfirm={() => {}} />);
    const confirm = screen.getByRole('button', { name: '确认删除' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入版本名确认'), { target: { value: 'V8.0.9' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入版本名确认'), { target: { value: ' V8.0.8 ' } });
    expect(confirm).toBeEnabled();
  });

  it('calls onConfirm then closes on confirmed delete', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<DeleteVersionDialog open versionName="V8.0.8" onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText('输入版本名确认'), { target: { value: 'V8.0.8' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open and toasts when delete fails', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('版本不存在'); });
    const onClose = vi.fn();
    render(<DeleteVersionDialog open versionName="V8.0.8" onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText('输入版本名确认'), { target: { value: 'V8.0.8' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('删除版本失败:版本不存在'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
