// frontend/src/components/worklog/__tests__/worklogComponents.test.tsx
// 工作记录页组件测试:partial 编辑保存(diff 不丢)、删除二次确认、AI 指南渲染 9 工具。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EntryItem } from '../EntryItem';
import { AiGuideView } from '../AiGuideView';
import { WORKLOG_TOOL_CATALOG, type WorklogEntry } from '@ai-task-flow/shared';

// react-markdown CJS 链在 node 层解析到根 react@18(monorepo 双 React 历史),
// 组件测试聚焦交互逻辑,detail 渲染 mock 为纯文本容器(展示保真由页面端到端覆盖)。
vi.mock('@/components/common/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => (
    <div data-testid="md-content">{content}</div>
  ),
}));

// toaster 含 lucide 图标(同双 React 问题),交互测试只需 toast 可调用
vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ui/label 走 @radix-ui/react-label(node_modules CJS,同双 React 问题),mock 为原生 label
vi.mock('@/components/ui/label', () => ({
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
}));

function makeEntry(overrides: Partial<WorklogEntry> = {}): WorklogEntry {
  return {
    id: 'e_test0001',
    title: '砍掉任务派发链路',
    detail: '删除 workflow 域',
    diff: 'diff --git a/backend/src/server.ts',
    files: [{ path: 'backend/src/server.ts', startLine: 12, endLine: 40 }],
    tags: ['refactor'],
    date: '2026-11-17',
    createdAt: 1763000000000,
    updatedAt: 1763000000000,
    ...overrides,
  };
}

describe('EntryItem', () => {
  const baseProps = {
    projectVersions: ['v1.2.0', 'v1.3.0'],
    currentProject: 'ai-task-flow',
    currentVersion: 'v1.2.0',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup(); // vitest 未开 globals,RTL 不会自动卸载,多次 render 会累积 DOM
  });

  it('should render title, tags, date and file badges', () => {
    render(
      <EntryItem {...baseProps} entry={makeEntry()} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('砍掉任务派发链路')).toBeInTheDocument();
    expect(screen.getByText('refactor')).toBeInTheDocument();
    expect(screen.getByText('2026-11-17')).toBeInTheDocument();
    expect(screen.getByText(/backend\/src\/server\.ts:12/)).toBeInTheDocument();
  });

  it('should call onSave with partial fields only (diff untouched by form)', async () => {
    // 表单只含 title/detail/tags/version——diff/files 不在 payload,后端 partial 语义保留它们
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EntryItem {...baseProps} entry={makeEntry()} onSave={onSave} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByText('编辑'));
    const input = screen.getByDisplayValue('砍掉任务派发链路');
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][1];
    expect(payload.title).toBe('新标题');
    expect(payload).not.toHaveProperty('diff');
    expect(payload).not.toHaveProperty('files');
  });

  it('should require second click to confirm delete', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<EntryItem {...baseProps} entry={makeEntry()} onSave={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('删除'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('确认删除')).toBeInTheDocument();

    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('e_test0001'));
  });

  it('should show related project badge and unmatched path hint', () => {
    render(
      <EntryItem
        {...baseProps}
        entry={makeEntry({ relatedProjects: ['题库', '组卷'], pathUnmatched: true })}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('关联: 题库, 组卷')).toBeInTheDocument();
    expect(screen.getByText('当前路径未归属项目')).toBeInTheDocument();
  });

  it('should not show related badge or unmatched hint for plain entry', () => {
    render(<EntryItem {...baseProps} entry={makeEntry()} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/^关联:/)).not.toBeInTheDocument();
    expect(screen.queryByText('当前路径未归属项目')).not.toBeInTheDocument();
  });

  it('should toggle diff panel with DiffViewer content', () => {
    render(<EntryItem {...baseProps} entry={makeEntry()} onSave={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/diff --git/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('展开'));
    fireEvent.click(screen.getByText('展开 diff'));
    expect(screen.getByText(/diff --git a\/backend\/src\/server\.ts/)).toBeInTheDocument();
  });
});

describe('AiGuideView', () => {
  it('should render all 9 tools from catalog with prompt examples', () => {
    render(<AiGuideView />);
    for (const tool of WORKLOG_TOOL_CATALOG) {
      expect(screen.getByText(tool.name)).toBeInTheDocument();
    }
    // 示例话术渲染(至少校验第一条)
    expect(screen.getByText(WORKLOG_TOOL_CATALOG[0].userPromptExample)).toBeInTheDocument();
  });
});
