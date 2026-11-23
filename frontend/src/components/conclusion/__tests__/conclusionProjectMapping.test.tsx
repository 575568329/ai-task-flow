// 回归测试:结论卡的项目引用与名称映射。
//  - 主项目名优先用 worklog 项目树的 id → name 映射,映射不到退回卡片上的名称快照;
//  - 关联项目按 id 映射最新名称,映射不到退回名称快照;
//  - 项目已被删除(有 id 但树上查不到)显示弱提示「项目已删除」;
//  - 表单可录入关联项目(逗号分隔)并按数组提交;追加时预填已有值;
//  - 空态说明结论卡按会话归档,不按项目路径归类。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { Conclusion, ConclusionSummary, WorklogData } from '@ai-task-flow/shared';
import { ConclusionView } from '../ConclusionView';
import { conclusionApi } from '@/api/conclusion';
import { worklogApi } from '@/api/worklog';

// 同其它结论页测试:避免 react-markdown 的 CJS 链解析到根 react@18。
vi.mock('@/components/common/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => (
    <div data-testid="md-content">{content}</div>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// 阶段多选走 framer-motion,会解析到根 react@18;测试不关心下拉交互。
vi.mock('@/components/ui/multi-select', () => ({
  MultiSelect: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="stage-multi-select">{placeholder}</div>
  ),
}));

vi.mock('@/api/conclusion', () => ({
  conclusionApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    append: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/api/worklog', () => ({
  worklogApi: { getTree: vi.fn() },
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { viewEnterTick: Record<string, number> }) => T): T =>
    selector({ viewEnterTick: {} }),
}));

function treeWith(...projects: Array<{ id: string; name: string }>): WorklogData {
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: 1,
      versions: [],
    })),
  };
}

function summary(over: Partial<ConclusionSummary> = {}): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: '旧项目名', title: '卡片标题', rev: 1,
    latestDate: '2026-11-18', latestDecisionExcerpt: '摘要',
    source: { tool: 'manual' }, createdAt: 1, updatedAt: 1, ...over,
  };
}

function detail(over: Partial<Conclusion> = {}): Conclusion {
  return {
    id: 'c_1', scope: 'project', project: '旧项目名', title: '卡片标题',
    revisions: [
      { rev: 1, decision: '正文', source: { tool: 'manual' }, date: '2026-11-18', createdAt: 1 },
    ],
    createdAt: 1, updatedAt: 1, ...over,
  };
}

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest('article') as HTMLElement;
}

describe('ConclusionView project mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup(); // vitest 未开 globals,RTL 不会自动卸载
  });

  it('should map project ids to latest names and render related project badges', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({
      conclusions: [summary({
        project: '旧项目名', projectId: 'p_1',
        relatedProjects: ['旧关联'], relatedProjectIds: ['p_2'],
      })],
    });
    vi.mocked(worklogApi.getTree).mockResolvedValue(treeWith(
      { id: 'p_1', name: '新项目名' },
      { id: 'p_2', name: '题库' },
    ));

    render(<ConclusionView />);
    fireEvent.click(await screen.findByText('全部'));
    await screen.findByText('卡片标题');

    const card = cardOf('卡片标题');
    expect(within(card).getByText('新项目名')).toBeTruthy();
    expect(within(card).getByText(/关联.*题库/)).toBeTruthy();
    // id 映射命中时不再展示快照名称
    expect(within(card).queryByText('旧项目名')).toBeNull();
    expect(within(card).queryByText('旧关联')).toBeNull();
  });

  it('should fall back to snapshot names and flag deleted project', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({
      conclusions: [summary({
        project: '已删项目', projectId: 'p_gone',
        relatedProjects: ['遗留关联'], relatedProjectIds: ['p_gone2'],
      })],
    });
    // 项目树为空且已成功加载 → 有 id 却查不到 = 项目已删除
    vi.mocked(worklogApi.getTree).mockResolvedValue(treeWith());

    render(<ConclusionView />);
    fireEvent.click(await screen.findByText('全部'));
    await screen.findByText('卡片标题');

    const card = cardOf('卡片标题');
    expect(within(card).getByText('已删项目')).toBeTruthy();
    expect(within(card).getByText(/项目已删除/)).toBeTruthy();
    expect(within(card).getByText(/关联.*遗留关联/)).toBeTruthy();
  });

  it('should explain archive semantics in empty state', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({ conclusions: [] });
    vi.mocked(worklogApi.getTree).mockResolvedValue(treeWith());

    render(<ConclusionView />);
    fireEvent.click(await screen.findByText('全部'));

    expect(await screen.findByText(/结论卡按会话归档/)).toBeTruthy();
  });

  it('should prefill related projects when appending', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({
      conclusions: [summary({ relatedProjects: ['题库'], relatedProjectIds: ['p_2'] })],
    });
    vi.mocked(worklogApi.getTree).mockResolvedValue(treeWith({ id: 'p_2', name: '题库' }));
    vi.mocked(conclusionApi.get).mockResolvedValue(detail({ relatedProjects: ['题库'], relatedProjectIds: ['p_2'] }));

    render(<ConclusionView />);
    fireEvent.click(await screen.findByText('全部'));
    await screen.findByText('卡片标题');
    const card = cardOf('卡片标题');

    fireEvent.click(within(card).getByTitle('展开/收起'));
    await waitFor(() => expect(screen.getByText('编辑（追加新版）')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑（追加新版）'));

    expect(screen.getByDisplayValue('题库')).toBeTruthy();
  });

  it('should submit related projects parsed from the form', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({ conclusions: [] });
    vi.mocked(worklogApi.getTree).mockResolvedValue(treeWith());
    vi.mocked(conclusionApi.create).mockResolvedValue({ id: 'c_new', rev: 1, path: 'c_new' });

    render(<ConclusionView />);
    fireEvent.click(await screen.findByText('新建结论'));
    fireEvent.change(screen.getByPlaceholderText('关联项目（逗号分隔）'), {
      target: { value: '题库, 资源加工' },
    });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => expect(conclusionApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ relatedProjects: ['题库', '资源加工'] }),
    ));
  });
});
