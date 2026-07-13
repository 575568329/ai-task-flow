// frontend/src/stores/knowledgeStore.ts
// 知识库状态管理
import { create } from 'zustand';
import type { KnowledgeManifest, KnowledgeFileNode } from '@ai-task-flow/shared';

interface KnowledgeState {
  manifest: KnowledgeManifest | null;
  currentPath: string | null;
  /** md 编辑/预览模式(view 预览 / edit 编辑);切文档自动回 view,新建后置 edit */
  mode: 'view' | 'edit';
  searchQuery: string;
  selectedTags: string[];
  loading: boolean;
  error: string | null;

  // Actions
  setManifest: (manifest: KnowledgeManifest) => void;
  setCurrentPath: (path: string | null) => void;
  setMode: (mode: 'view' | 'edit') => void;
  setSearchQuery: (query: string) => void;
  setSelectedTags: (tags: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Computed
  getCurrentDoc: () => KnowledgeFileNode | null;
  getFilteredDocs: () => KnowledgeFileNode[];
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  manifest: null,
  currentPath: null,
  mode: 'view',
  searchQuery: '',
  selectedTags: [],
  loading: false,
  error: null,

  setManifest: (manifest) => set({ manifest, error: null }),
  // 切文档默认回预览态;新建流程随后 setMode('edit') 覆盖
  setCurrentPath: (path) => set({ currentPath: path, mode: 'view' }),
  setMode: (mode) => set({ mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  getCurrentDoc: () => {
    const { manifest, currentPath } = get();
    if (!manifest || !currentPath) return null;
    return manifest.flatDocs.find(doc => doc.path === currentPath) || null;
  },

  getFilteredDocs: () => {
    const { manifest, searchQuery, selectedTags } = get();
    if (!manifest) return [];

    let docs = manifest.flatDocs;

    // 标签筛选
    if (selectedTags.length > 0) {
      docs = docs.filter(doc =>
        doc.tags && doc.tags.some(tag => selectedTags.includes(tag))
      );
    }

    // 搜索筛选(标题 + 正文预览)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      docs = docs.filter(doc =>
        doc.title.toLowerCase().includes(query) ||
        doc.contentPreview?.toLowerCase().includes(query)
      );
    }

    return docs;
  },
}));
