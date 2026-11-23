// frontend/src/components/worklog/__tests__/worklogFilterHints.test.tsx
// 筛选完整性与提示:项目筛选下拉可叠加、需求范围外改动弱提示、record/update 的 warnings 走 info toast。
// 重依赖子组件打桩,只验证 WorklogView 的接线与渲染。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorklogView } from '../WorklogView';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import type { WorklogData, WorklogEntry } from '@ai-task-flow/shared';

vi.mock('@/api/worklog', () => ({
  worklogApi: {
    getTree: vi.fn(),
    record: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { viewEnterTick: Record<string, number> }) => T): T =>
    selector({ viewEnterTick: {} }),
}));

vi.mock('../VersionRequirementTree', () => ({
  VersionRequirementTree: (props: {
    onSelect: (sel: { versionId?: string; requirementId?: string }) => void;
  }) => (
    <div data-testid="tree">
      <button type="button" onClick={() => props.onSelect({ versionId: 'v_1', requirementId: 'r_1' })}>
        stub-select-requirement
      </button>
    </div>
  ),
}));

vi.mock('../VersionDialog', () => ({ VersionDialog: () => null }));
vi.mock('../RequirementDialog', () => ({ RequirementDialog: () => null }));
vi.mock('../DeleteVersionDialog', () => ({ DeleteVersionDialog: () => null }));
vi.mock('../ProjectDictionaryDialog', () => ({ ProjectDictionaryDialog: () => null }));
vi.mock('../AiGuideView', () => ({ AiGuideView: () => null }));
vi.mock('@/components/common/WorkStageMultiSelect', () => ({ WorkStageMultiSelect: () => null }));

vi.mock('../EntryItem', () => ({
  EntryItem: ({ entry, onSave }: {
    entry: WorklogEntry;
    onSave: (id: string, patch: { title?: string }) => Promise<void>;
  }) => (
    <div data-testid="entry-item">
      {entry.title}
      <button type="button" onClick={() => void onSave(entry.id, { title: `${entry.title}-改` })}>
        stub-save-{entry.id}
      </button>
    </div>
  ),
}));

vi.mock('../NewEntryForm', () => ({
  NewEntryForm: ({ onCreate }: {
    onCreate: (input: {
      versionId: string; requirementId: string; title: string; detail: string;
    }) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => void onCreate({
        versionId: 'v_1', requirementId: 'r_1', title: '新条目', detail: '详情',
      })}
    >
      stub-create-entry
    </button>
  ),
}));

function entry(over: Partial<WorklogEntry> & Pick<WorklogEntry, 'id' | 'title'>): WorklogEntry {
  return { detail: 'd', date: '2026-11-23', createdAt: 1, updatedAt: 1, ...over };
}

const tree: WorklogData = {
  projects: [
    { id: 'p_1', name: '项目A', createdAt: 1 },
    { id: 'p_2', name: '项目B', createdAt: 2 },
  ],
  versions: [{
    id: 'v_1', name: 'V1', createdAt: 1,
    requirements: [{
      id: 'r_1', title: '需求A', projects: ['项目A'], createdAt: 1,
      entries: [
        entry({ id: 'e_1', title: '条目A', project: '项目A', stage: 'dev', createdAt: 2 }),
        entry({ id: 'e_2', title: '条目B', project: '项目B', stage: 'dev', createdAt: 1 }),
      ],
    }],
  }],
};

const mockedGetTree = vi.mocked(worklogApi.getTree);
const mockedRecord = vi.mocked(worklogApi.record);
const mockedUpdate = vi.mocked(worklogApi.update);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetTree.mockResolvedValue(tree);
});

afterEach(() => {
  cleanup();
});

describe('WorklogView 筛选与提示', () => {
  it('shows outside-scope projects when a requirement is selected', async () => {
    render(<WorklogView />);
    await screen.findByTestId('tree');
    expect(screen.queryByText(/存在范围外改动/)).toBeNull();

    fireEvent.click(screen.getByText('stub-select-requirement'));

    // 需求计划项目只有「项目A」,条目实际改动了「项目B」
    expect(await screen.findByText('存在范围外改动：项目B')).toBeInTheDocument();
  });

  it('stacks the project filter with the selected requirement', async () => {
    render(<WorklogView />);
    await screen.findByTestId('tree');
    fireEvent.click(screen.getByText('stub-select-requirement'));

    await waitFor(() => expect(screen.getAllByTestId('entry-item')).toHaveLength(2));

    fireEvent.change(screen.getByLabelText('按项目筛选'), { target: { value: '项目B' } });

    const items = screen.getAllByTestId('entry-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('条目B');
  });

  it('surfaces record warnings via info toast', async () => {
    mockedRecord.mockResolvedValue({
      entryId: 'e_new', path: 'V1/需求A/e_new', createdProject: false, createdVersion: false,
      warnings: ['以下关联项目不存在，已忽略：拼错的'],
    });
    render(<WorklogView />);
    await screen.findByTestId('tree');

    fireEvent.click(screen.getByText('记一条'));
    fireEvent.click(screen.getByText('stub-create-entry'));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('以下关联项目不存在，已忽略：拼错的'));
    expect(toast.success).toHaveBeenCalledWith('已记录');
  });

  it('surfaces update warnings via info toast', async () => {
    mockedUpdate.mockResolvedValue({
      id: 'e_1', path: 'V1/需求A/e_1',
      warnings: ['当前路径未归属任何项目，可在页面绑定路径'],
    });
    render(<WorklogView />);
    await screen.findByTestId('tree');
    fireEvent.click(screen.getByText('stub-select-requirement'));

    fireEvent.click(await screen.findByText('stub-save-e_1'));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('当前路径未归属任何项目，可在页面绑定路径'));
    expect(toast.success).toHaveBeenCalledWith('已更新');
  });
});
