// 知识库导入引导:加载时探测 suggestion,建议时在树顶部显示提示条,点击复用导入流程并回显跳过数。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { KnowledgeManifest } from '@ai-task-flow/shared';
import { fetchImportSuggestion, fetchManifest, importKnowledge } from '@/api/knowledge';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import { KnowledgeView } from '../KnowledgeView';

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="handle" />,
}));

vi.mock('@/components/knowledge/KnowledgeTree', () => ({
  KnowledgeTree: () => <div data-testid="tree" />,
}));

vi.mock('@/components/knowledge/KnowledgeViewer', () => ({
  KnowledgeViewer: () => <div data-testid="viewer" />,
}));

vi.mock('@/api/knowledge', () => ({
  fetchManifest: vi.fn(),
  fetchImportSuggestion: vi.fn(),
  importKnowledge: vi.fn(),
}));

vi.mock('@/api/worklog', () => ({
  worklogApi: { getTree: vi.fn() },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { localAccess: boolean }) => T): T =>
    selector({ localAccess: true }),
}));

vi.mock('@/hooks/useNarrowViewport', () => ({ useNarrowViewport: () => false }));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/components/ui/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), prompt: vi.fn() }),
}));

const manifest: KnowledgeManifest = {
  tree: { type: 'dir', name: 'knowledge-base', title: '知识库', children: [] },
  flatDocs: [],
  tags: [],
  backlinks: {},
  generatedAt: 0,
  basePath: '/kb',
};

const mockedFetchManifest = vi.mocked(fetchManifest);
const mockedSuggestion = vi.mocked(fetchImportSuggestion);
const mockedImport = vi.mocked(importKnowledge);
const mockedGetTree = vi.mocked(worklogApi.getTree);

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchManifest.mockResolvedValue(manifest);
  mockedGetTree.mockResolvedValue({ projects: [], programs: [], versions: [] });
  mockedSuggestion.mockResolvedValue({ suggested: true, sourceCount: 67, targetCount: 8 });
  mockedImport.mockResolvedValue({ copied: 67, skipped: 3, conflicts: [], errors: [] });
});

afterEach(cleanup);

describe('KnowledgeView 导入引导', () => {
  it('shows the banner when suggestion is true and imports on click', async () => {
    render(<KnowledgeView />);

    expect(
      await screen.findByText('检测到仓库 knowledge-base 下有 67 篇历史文档未导入'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导入' }));

    await waitFor(() => expect(mockedImport).toHaveBeenCalledTimes(1));
    // toast 摘要包含内容级幂等的跳过数
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        '已复制 67 篇,冲突 0 篇,跳过 3 篇(内容已存在)',
      ),
    );
  });

  it('hides the banner when suggestion is false', async () => {
    mockedSuggestion.mockResolvedValue({ suggested: false, sourceCount: 67, targetCount: 67 });
    render(<KnowledgeView />);

    await waitFor(() => expect(mockedSuggestion).toHaveBeenCalled());
    expect(screen.queryByText(/篇历史文档未导入/)).toBeNull();
  });
});
