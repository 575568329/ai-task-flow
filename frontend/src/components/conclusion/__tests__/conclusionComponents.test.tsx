import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ConclusionCardItem } from '../ConclusionCardItem';

// react-markdown CJS 链在 node 层解析到根 react@18（monorepo 双 React 历史）。
// 组件测试聚焦交互，Markdown 展示由页面端到端覆盖。
vi.mock('@/components/common/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => (
    <div data-testid="md-content">{content}</div>
  ),
}));

function summary(over: Partial<ConclusionSummary> = {}): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
    rev: 2, latestDate: '2026-11-18', latestDecisionExcerpt: '最新结论摘要',
    source: {
      tool: 'claude-code',
      conversationId: '614608ad-5990-4757-a1f6-2cdb84e83f84',
      conversationName: '话题A',
    },
    createdAt: 1, updatedAt: 2, ...over,
  };
}

function detail(): Conclusion {
  return {
    id: 'c_1', scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
    revisions: [
      {
        rev: 1, decision: '旧结论', data: '旧数据',
        source: { tool: 'claude-code' }, date: '2026-11-17', createdAt: 1,
        changeNote: '初始',
      },
      {
        rev: 2, decision: '新结论', openItems: '待办X',
        source: { tool: 'zcode', conversationName: '话题B' }, date: '2026-11-18', createdAt: 2,
        changeNote: '补数据后改结论',
      },
    ],
    createdAt: 1, updatedAt: 2,
  };
}

describe('ConclusionCardItem', () => {
  it('should show latest excerpt when collapsed and latest content when expanded', () => {
    const props = {
      summary: summary(),
      onToggle: vi.fn(),
      onEdit: vi.fn(),
      onPatch: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(<ConclusionCardItem {...props} expanded={false} />);
    expect(screen.getByText('最新结论摘要')).toBeTruthy();
    expect(screen.getByText(/话题A/)).toBeTruthy();
    expect(screen.getByText(/614608ad/)).toBeTruthy();
    expect(screen.queryByText('新结论')).toBeNull();

    rerender(<ConclusionCardItem {...props} expanded detail={detail()} />);
    // 最新版正文与演进时间线都可能出现同一段文字，用 getAllByText 断言存在
    expect(screen.getAllByText('新结论').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待办X').length).toBeGreaterThan(0);
    expect(screen.getByText(/补数据后改结论/)).toBeTruthy();
    // changeNote 与「变更：」同处一个 <p>，RTL 按元素整体文本精确匹配，故与上一行一致用正则
    expect(screen.getByText(/初始/)).toBeTruthy();
  });
});
