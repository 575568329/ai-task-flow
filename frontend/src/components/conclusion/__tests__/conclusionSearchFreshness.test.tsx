// 回归测试:搜索结果的新鲜度与归属。
//  1) 写操作(删除)后 refresh() 必须让带关键词的搜索重新拉取,不能让已删卡残留在搜索结果里;
//  2) 旧关键词的慢响应不得覆盖新关键词的结果。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ConclusionView } from '../ConclusionView';
import { conclusionApi } from '@/api/conclusion';

// 同 worklog 测试：避免 react-markdown 的 CJS 链解析到根 react@18。
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

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// uiStore 构造时会读 matchMedia/localStorage,测试只用到激活打点,直接给纯函数替身
vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { viewEnterTick: Record<string, number> }) => T): T =>
    selector({ viewEnterTick: {} }),
}));

function summary(id: string, title: string, updatedAt: number): ConclusionSummary {
  return {
    id, scope: 'project', project: 'p', title, rev: 1,
    latestDate: '2026-11-18', latestDecisionExcerpt: `${title}摘要`,
    source: { tool: 'manual' }, createdAt: 1, updatedAt,
  };
}

function detail(id: string, title: string): Conclusion {
  return {
    id, scope: 'project', project: 'p', title,
    revisions: [
      { rev: 1, decision: `${title}正文`, source: { tool: 'manual' }, date: '2026-11-18', createdAt: 1 },
    ],
    createdAt: 1, updatedAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('ConclusionView search freshness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup(); // vitest 未开 globals,RTL 不会自动卸载
    vi.restoreAllMocks();
  });

  it('should refetch keyword results after a write so deleted cards disappear', async () => {
    let store = [summary('c_a', '卡片A', 2), summary('c_b', '卡片B', 1)];
    vi.mocked(conclusionApi.list).mockImplementation(async (input = {}) => {
      const keyword = input.keyword;
      return { conclusions: keyword ? store.filter((card) => card.title.includes(keyword)) : [...store] };
    });
    vi.mocked(conclusionApi.get).mockImplementation(async (id) => detail(id, id === 'c_b' ? '卡片B' : '卡片A'));
    vi.mocked(conclusionApi.remove).mockImplementation(async (id) => {
      store = store.filter((card) => card.id !== id);
      return { deleted: true };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConclusionView />);
    await screen.findByText('卡片A');

    const input = screen.getByPlaceholderText('搜索标题/历史结论…');
    fireEvent.change(input, { target: { value: '卡片' } });
    await screen.findByText('搜索结果 · 2');

    // 展开 B 并删除(展开后才出现删除按钮)
    fireEvent.click(within(screen.getByText('卡片B').closest('article') as HTMLElement).getByTitle('展开/收起'));
    // 正文在「结论/决策」节与演进时间线都会渲染,故断言存在而非唯一
    expect((await screen.findAllByText('卡片B正文')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('删除'));

    // refresh() 后搜索必须重拉:已删卡不能继续留在搜索结果中
    await waitFor(() => {
      expect(screen.getByText('搜索结果 · 1')).toBeTruthy();
      expect(screen.queryByText('卡片B')).toBeNull();
    });
    const keywordCalls = vi.mocked(conclusionApi.list).mock.calls.filter((call) => call[0]?.keyword);
    expect(keywordCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('should discard a stale keyword response that resolves after a newer one', async () => {
    const slowOld = deferred<{ conclusions: ConclusionSummary[] }>();
    vi.mocked(conclusionApi.list).mockImplementation((input = {}) => {
      if (input.keyword === '旧词') return slowOld.promise;
      if (input.keyword === '新词') {
        return Promise.resolve({ conclusions: [summary('c_new', '新词结果', 1)] });
      }
      return Promise.resolve({ conclusions: [] });
    });

    render(<ConclusionView />);
    const input = await screen.findByPlaceholderText('搜索标题/历史结论…');

    fireEvent.change(input, { target: { value: '旧词' } });
    await waitFor(
      () => expect(conclusionApi.list).toHaveBeenCalledWith({ keyword: '旧词' }),
      { timeout: 2000 },
    );

    fireEvent.change(input, { target: { value: '新词' } });
    await waitFor(
      () => expect(conclusionApi.list).toHaveBeenCalledWith({ keyword: '新词' }),
      { timeout: 2000 },
    );
    await screen.findByText('新词结果');

    // 旧词的慢响应此刻才回来,归属守卫必须丢弃
    slowOld.resolve({ conclusions: [summary('c_old', '旧词结果', 1)] });
    await waitFor(() => expect(screen.queryByText('旧词结果')).toBeNull());
    expect(screen.getByText('新词结果')).toBeTruthy();
  });
});
