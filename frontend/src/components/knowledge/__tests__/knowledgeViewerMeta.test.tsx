// KnowledgeViewer 编辑关联:调用 updateDocMeta、刷新 manifest、徽标随新 frontmatter 更新。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { KnowledgeFileNode, KnowledgeManifest, WorklogData } from '@ai-task-flow/shared';
import { buildWorklogIndex } from '@/lib/knowledgeViews';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { fetchDoc, fetchManifest, updateDocMeta } from '@/api/knowledge';
import { KnowledgeViewer } from '../KnowledgeViewer';

vi.mock('@/components/common/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => <div data-testid="md-content">{content}</div>,
}));

vi.mock('@/components/knowledge/MdEditor', () => ({
  MdEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));

vi.mock('@/lib/docExport', () => ({ exportElementToPdf: vi.fn() }));
vi.mock('@/lib/copyPath', () => ({ copyDiskPath: vi.fn() }));

vi.mock('@/components/ui/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(false), prompt: vi.fn() }),
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/api/knowledge', () => ({
  fetchDoc: vi.fn(),
  fetchManifest: vi.fn(),
  updateDocMeta: vi.fn(),
  saveDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getRawUrl: (path: string) => `/api/knowledge/raw?path=${path}`,
}));

function docNode(over: Partial<KnowledgeFileNode> = {}): KnowledgeFileNode {
  return { type: 'file', name: 'a.md', title: 'A 文档', path: 'a.md', kind: 'md', mtime: 0, ...over };
}

function manifestWith(doc: KnowledgeFileNode): KnowledgeManifest {
  return {
    tree: { type: 'dir', name: 'knowledge-base', title: '知识库', children: [doc] },
    flatDocs: [doc],
    tags: [],
    backlinks: {},
    generatedAt: 0,
    basePath: '/kb',
  };
}

const worklogTree: WorklogData = {
  projects: [{ id: 'p1', name: 'ai-task-flow', createdAt: 0 }],
  versions: [
    {
      id: 'v1',
      name: 'V8.0.8',
      createdAt: 0,
      requirements: [{ id: 'r1', title: '需求一', createdAt: 0, entries: [] }],
    },
  ],
};

describe('KnowledgeViewer 编辑关联', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchDoc).mockResolvedValue({ path: 'a.md', kind: 'md', content: '正文' });
    vi.mocked(fetchManifest).mockResolvedValue(
      manifestWith(docNode({ frontmatter: { versionId: 'v1', requirementId: 'r1' } })),
    );
    vi.mocked(updateDocMeta).mockResolvedValue({ path: 'a.md' });

    useKnowledgeStore.setState({
      manifest: manifestWith(docNode()),
      currentPath: 'a.md',
      mode: 'view',
      searchQuery: '',
      selectedTags: [],
      favorites: [],
      filterFavorites: false,
      filterRecent: false,
      worklogIndex: buildWorklogIndex(worklogTree),
      loading: false,
      error: null,
    });
  });

  it('saves associations, refreshes manifest and updates badges', async () => {
    render(<KnowledgeViewer />);

    await screen.findByText('正文');
    expect(screen.getByText('未关联')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '编辑关联' }));
    fireEvent.change(screen.getByLabelText('关联版本'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('关联需求'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(vi.mocked(updateDocMeta)).toHaveBeenCalledWith({
        path: 'a.md',
        versionId: 'v1',
        requirementId: 'r1',
        projectId: '',
        stage: '',
      }),
    );
    await waitFor(() => expect(vi.mocked(fetchManifest)).toHaveBeenCalled());

    // manifest 刷新后的关联徽标(映射为名称)
    expect(await screen.findByText('版本 · V8.0.8')).toBeTruthy();
    expect(screen.getByText('需求 · 需求一')).toBeTruthy();
    // 无未保存改动时按最新文件回填正文(fetchDoc 至少两次:挂载 + meta 保存后)
    expect(vi.mocked(fetchDoc).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
