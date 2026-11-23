// frontend/src/components/worklog/__tests__/worklogViewWiring.test.tsx
// WorklogView 弹窗接线:创建/删除弹窗回调后必须刷新并把 selection 落到新版本/新需求,
// 删除必须先经强确认弹窗,删除后清空指向该版本的选中态。
// 树与三个弹窗打桩(真实实现拉入 radix/motion,双 React),只验证父子回调契约。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorklogView } from '../WorklogView';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import type { WorklogData } from '@ai-task-flow/shared';

vi.mock('@/api/worklog', () => ({
  worklogApi: {
    getTree: vi.fn(),
    createVersion: vi.fn(),
    createRequirement: vi.fn(),
    deleteVersion: vi.fn(),
    renameVersion: vi.fn(),
    renameRequirement: vi.fn(),
    deleteRequirement: vi.fn(),
  },
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// uiStore 在模块初始化时读 matchMedia(localStorage),jsdom 未实现;按结论页测试先例注入空 tick。
vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { viewEnterTick: Record<string, number> }) => T): T =>
    selector({ viewEnterTick: {} }),
}));

vi.mock('../VersionRequirementTree', () => ({
  VersionRequirementTree: (props: {
    selection: { versionId?: string; requirementId?: string };
    onSelect: (sel: { versionId?: string; requirementId?: string }) => void;
    onCreateVersionClick?: () => void;
    onCreateRequirementClick?: (versionId: string) => void;
    onDeleteVersionClick?: (versionId: string) => void;
  }) => (
    <div data-testid="tree" data-selection={JSON.stringify(props.selection)}>
      <button type="button" onClick={() => props.onCreateVersionClick?.()}>stub-open-version</button>
      <button type="button" onClick={() => props.onCreateRequirementClick?.('v_1')}>stub-open-requirement</button>
      <button type="button" onClick={() => props.onDeleteVersionClick?.('v_1')}>stub-open-delete</button>
      <button type="button" onClick={() => props.onSelect({ versionId: 'v_1' })}>stub-select-v1</button>
    </div>
  ),
}));

vi.mock('../VersionDialog', () => ({
  VersionDialog: ({ open, onCreated }: {
    open: boolean;
    onCreated?: (created: { id: string; name: string }) => void | Promise<void>;
  }) => (open ? (
    <button type="button" onClick={() => void onCreated?.({ id: 'v_new', name: 'V8.0.9' })}>
      stub-create-version
    </button>
  ) : null),
}));

vi.mock('../RequirementDialog', () => ({
  RequirementDialog: ({ versionId, onCreated }: {
    versionId: string;
    onCreated?: (created: { id: string; versionId: string; title: string }) => void | Promise<void>;
  }) => (
    <button type="button" onClick={() => void onCreated?.({ id: 'r_new', versionId, title: '新需求' })}>
      stub-create-requirement
    </button>
  ),
}));

vi.mock('../DeleteVersionDialog', () => ({
  DeleteVersionDialog: ({ versionName, onConfirm, onClose }: {
    versionName: string;
    onConfirm: () => void | Promise<void>;
    onClose: () => void;
  }) => (
    <div data-testid="delete-dialog">
      <span>{versionName}</span>
      <button type="button" onClick={async () => { await onConfirm(); onClose(); }}>stub-confirm-delete</button>
    </div>
  ),
}));

// 未在本文件关注、但会拉入 radix/虚拟列表/重依赖的子组件
vi.mock('../ProjectDictionaryDialog', () => ({ ProjectDictionaryDialog: () => null }));
vi.mock('../EntryItem', () => ({ EntryItem: () => null }));
vi.mock('../NewEntryForm', () => ({ NewEntryForm: () => null }));
vi.mock('../AiGuideView', () => ({ AiGuideView: () => null }));
vi.mock('@/components/common/WorkStageMultiSelect', () => ({ WorkStageMultiSelect: () => null }));

const tree: WorklogData = {
  projects: [],
  versions: [
    {
      id: 'v_1', name: 'V8.0.8', createdAt: 1,
      requirements: [{ id: 'r_1', title: '需求A', createdAt: 1, entries: [] }],
    },
    { id: 'v_2', name: 'V8.0.7', createdAt: 2, requirements: [] },
  ],
};

const mockedGetTree = vi.mocked(worklogApi.getTree);
const mockedDeleteVersion = vi.mocked(worklogApi.deleteVersion);

function selectionOf(): string | null {
  return screen.getByTestId('tree').getAttribute('data-selection');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetTree.mockResolvedValue(tree);
  mockedDeleteVersion.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe('WorklogView 弹窗接线', () => {
  it('selects the newly created version and refreshes the tree', async () => {
    render(<WorklogView />);
    await screen.findByTestId('tree');
    expect(selectionOf()).toBe('{}');

    fireEvent.click(screen.getByTitle('新建版本')); // 顶栏入口打开 VersionDialog
    fireEvent.click(screen.getByText('stub-create-version')); // 弹窗 onCreated

    await waitFor(() => expect(selectionOf()).toBe(JSON.stringify({ versionId: 'v_new' })));
    expect(mockedGetTree).toHaveBeenCalledTimes(2); // 初始加载 + 创建后刷新
  });

  it('selects the newly created requirement under its version', async () => {
    render(<WorklogView />);
    await screen.findByTestId('tree');

    fireEvent.click(screen.getByText('stub-open-requirement'));
    fireEvent.click(screen.getByText('stub-create-requirement'));

    await waitFor(() => expect(selectionOf()).toBe(
      JSON.stringify({ versionId: 'v_1', requirementId: 'r_new' }),
    ));
    expect(mockedGetTree).toHaveBeenCalledTimes(2);
  });

  it('deletes a version only after the confirm dialog and clears its selection', async () => {
    render(<WorklogView />);
    await screen.findByTestId('tree');

    fireEvent.click(screen.getByText('stub-select-v1'));
    await waitFor(() => expect(selectionOf()).toBe(JSON.stringify({ versionId: 'v_1' })));

    fireEvent.click(screen.getByText('stub-open-delete'));
    expect(screen.getByTestId('delete-dialog')).toHaveTextContent('V8.0.8');
    expect(mockedDeleteVersion).not.toHaveBeenCalled(); // 打开弹窗本身不删除

    fireEvent.click(screen.getByText('stub-confirm-delete'));

    await waitFor(() => expect(mockedDeleteVersion).toHaveBeenCalledWith('v_1'));
    await waitFor(() => expect(selectionOf()).toBe('{}'));
    expect(toast.success).toHaveBeenCalledWith('版本已删除');
  });
});
