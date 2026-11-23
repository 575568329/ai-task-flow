// 知识库左侧树:视图切换(分类/版本/项目/阶段)、localStorage 记忆、「已关联/未关联」计数。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { KnowledgeFileNode, KnowledgeManifest, WorklogData } from '@ai-task-flow/shared';
import { buildWorklogIndex } from '@/lib/knowledgeViews';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { KnowledgeTree } from '../KnowledgeTree';

// radix/motion 系组件在 vitest 下会解析到根 react@18(monorepo 双 React 历史),此处用轻量替身。
vi.mock('@/components/ui/multi-select', () => ({
  MultiSelect: () => <div data-testid="multi-select" />,
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

vi.mock('@/components/ui/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(false), prompt: vi.fn() }),
}));

vi.mock('@/components/context-menu/ContextMenuHost', () => ({
  ContextMenuHost: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/copyPath', () => ({ copyDiskPath: vi.fn() }));

vi.mock('@/api/knowledge', () => ({
  createDoc: vi.fn(),
  fetchManifest: vi.fn(),
  deleteDoc: vi.fn(),
}));

function fileNode(path: string, title: string, over: Partial<KnowledgeFileNode> = {}): KnowledgeFileNode {
  return { type: 'file', name: `${path.split('/').pop()}`, title, path, kind: 'md', mtime: 0, ...over };
}

const linkedDoc = fileNode('a.md', 'A 文档', {
  frontmatter: { versionId: 'v1', requirementId: 'r1', projectId: 'p1', stage: 'design' },
});
const unlinkedDoc = fileNode('b.md', 'B 文档');

const manifest: KnowledgeManifest = {
  tree: { type: 'dir', name: 'knowledge-base', title: '知识库', children: [linkedDoc, unlinkedDoc] },
  flatDocs: [linkedDoc, unlinkedDoc],
  tags: [],
  backlinks: {},
  generatedAt: 0,
  basePath: '/kb',
};

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

describe('KnowledgeTree 多视图', () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    useKnowledgeStore.setState({
      manifest,
      currentPath: null,
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

  it('switches to version view, shows counts and groups, and remembers the choice', () => {
    render(<KnowledgeTree />);

    // 默认分类视图:目录树
    expect(screen.getByText('A 文档')).toBeTruthy();
    expect(screen.queryByText(/已关联/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '版本' }));

    expect(localStorage.getItem('ai-task-flow-knowledge-view')).toBe('version');
    expect(screen.getByText('已关联 1 / 未关联 1')).toBeTruthy();
    expect(screen.getByText('V8.0.8')).toBeTruthy();
    expect(screen.getByText('需求一')).toBeTruthy();
    expect(screen.getByText('未关联')).toBeTruthy();
  });

  it('switches to project view and maps project id to name', () => {
    render(<KnowledgeTree />);

    fireEvent.click(screen.getByRole('button', { name: '项目' }));

    expect(screen.getByText('ai-task-flow')).toBeTruthy();
    expect(screen.getByText('已关联 1 / 未关联 1')).toBeTruthy();
  });

  it('shows empty hint when no doc matches in association views', () => {
    useKnowledgeStore.setState({ searchQuery: '不存在的关键词' });
    render(<KnowledgeTree />);

    fireEvent.click(screen.getByRole('button', { name: '阶段' }));

    expect(screen.getByText('无匹配文档')).toBeTruthy();
  });

  it('restores the remembered view from localStorage', () => {
    localStorage.setItem('ai-task-flow-knowledge-view', 'stage');
    render(<KnowledgeTree />);

    expect(screen.getByText('已关联 1 / 未关联 1')).toBeTruthy();
    expect(screen.getByText('设计文档/实施计划')).toBeTruthy();
  });
});
