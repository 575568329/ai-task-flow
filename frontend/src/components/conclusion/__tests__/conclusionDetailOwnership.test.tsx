// 回归测试:详情请求归属守卫。
// 场景:先展开 A(慢请求在途)再展开 B,A 的响应后到——不得把 A 的详情落到 B 名下,
// 否则「编辑（追加新版）」/「改信息」会静默写错记录。
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

// 阶段多选走 framer-motion,同样会解析到根 react@18;测试不关心下拉交互,给纯展示替身。
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

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// uiStore 构造时会读 matchMedia/localStorage,测试里只用到激活打点,直接给纯函数替身
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

function detail(id: string, title: string, decision: string): Conclusion {
  return {
    id, scope: 'project', project: 'p', title,
    revisions: [
      { rev: 1, decision, source: { tool: 'manual' }, date: '2026-11-18', createdAt: 1 },
    ],
    createdAt: 1, updatedAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest('article') as HTMLElement;
}

describe('ConclusionView detail ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup(); // vitest 未开 globals,RTL 不会自动卸载
  });

  it('should discard a stale detail response so it never drives edit/patch', async () => {
    vi.mocked(conclusionApi.list).mockResolvedValue({
      conclusions: [summary('c_a', '卡片A', 2), summary('c_b', '卡片B', 1)],
    });
    const slowA = deferred<Conclusion>();
    const fastB = deferred<Conclusion>();
    vi.mocked(conclusionApi.get).mockImplementation((id) =>
      id === 'c_a' ? slowA.promise : fastB.promise,
    );

    render(<ConclusionView />);
    await screen.findByText('卡片A');

    // 先展开 A(响应挂起),随即展开 B
    fireEvent.click(within(cardOf('卡片A')).getByTitle('展开/收起'));
    fireEvent.click(within(cardOf('卡片B')).getByTitle('展开/收起'));

    fastB.resolve(detail('c_b', '卡片B', 'B-正文'));
    await waitFor(() => expect(screen.getAllByText('B-正文').length).toBeGreaterThan(0));

    // A 的慢响应后到,必须被归属守卫丢弃
    slowA.resolve(detail('c_a', '卡片A', 'A-正文'));
    await Promise.resolve();
    await waitFor(() => {
      expect(screen.queryAllByText('A-正文')).toHaveLength(0);
      expect(screen.getAllByText('B-正文').length).toBeGreaterThan(0);
    });

    // 纵深防御:B 的编辑入口只能带出 B 的内容,绝不预填 A
    fireEvent.click(screen.getByText('编辑（追加新版）'));
    expect(screen.getByDisplayValue('B-正文')).toBeTruthy();
    expect(screen.queryByDisplayValue('A-正文')).toBeNull();
  });
});
