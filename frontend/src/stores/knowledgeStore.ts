// frontend/src/stores/knowledgeStore.ts
// 知识库状态管理
import { create } from 'zustand';
import type { KnowledgeManifest, KnowledgeFileNode } from '@ai-task-flow/shared';

const FAVORITES_KEY = 'ai-task-flow-knowledge-favorites';

/** 「新内容」阈值:最近 3 天(毫秒,用于和 Date.now() 对齐) */
export const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 判断 mtime 是否落在「近3天」内。
 * 后端返回的 mtime 是 Unix 秒(见 shared 的 KnowledgeFileNode),
 * 这里统一 *1000 转毫秒再与 Date.now() 比较 —— 直接拿秒跟毫秒阈值比会恒为 false。
 */
export function isRecentMtime(mtimeSec: number): boolean {
  return mtimeSec * 1000 >= Date.now() - RECENT_MS;
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

interface KnowledgeState {
  manifest: KnowledgeManifest | null;
  currentPath: string | null;
  /** md 编辑/预览模式(view 预览 / edit 编辑);切文档自动回 view,新建后置 edit */
  mode: 'view' | 'edit';
  searchQuery: string;
  selectedTags: string[];
  /** 收藏的文档 path 列表(localStorage 持久化,跨会话保留) */
  favorites: string[];
  /** 过滤器:仅看收藏 */
  filterFavorites: boolean;
  /** 过滤器:仅看最近 3 天新增/更新的文档 */
  filterRecent: boolean;
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
  toggleFavorite: (path: string) => void;
  setFilterFavorites: (on: boolean) => void;
  setFilterRecent: (on: boolean) => void;

  // Computed
  getCurrentDoc: () => KnowledgeFileNode | null;
  getFilteredDocs: () => KnowledgeFileNode[];
  isFavorite: (path: string) => boolean;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  manifest: null,
  currentPath: null,
  mode: 'view',
  searchQuery: '',
  selectedTags: [],
  favorites: loadFavorites(),
  filterFavorites: false,
  filterRecent: false,
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

  toggleFavorite: (path) => {
    const cur = get().favorites;
    const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    set({ favorites: next });
  },
  setFilterFavorites: (on) => set({ filterFavorites: on }),
  setFilterRecent: (on) => set({ filterRecent: on }),

  isFavorite: (path) => get().favorites.includes(path),

  getCurrentDoc: () => {
    const { manifest, currentPath } = get();
    if (!manifest || !currentPath) return null;
    return manifest.flatDocs.find((doc) => doc.path === currentPath) || null;
  },

  getFilteredDocs: () => {
    const { manifest, searchQuery, selectedTags, favorites, filterFavorites, filterRecent } = get();
    if (!manifest) return [];

    let docs = manifest.flatDocs;

    // 收藏筛选
    if (filterFavorites) {
      docs = docs.filter((doc) => favorites.includes(doc.path));
    }

    // 新内容筛选(近 3 天)
    if (filterRecent) {
      docs = docs.filter((doc) => isRecentMtime(doc.mtime));
    }

    // 标签筛选
    if (selectedTags.length > 0) {
      docs = docs.filter(
        (doc) => doc.tags && doc.tags.some((tag) => selectedTags.includes(tag)),
      );
    }

    // 搜索筛选(标题 + 正文预览)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      docs = docs.filter(
        (doc) =>
          doc.title.toLowerCase().includes(query) ||
          doc.contentPreview?.toLowerCase().includes(query),
      );
    }

    return docs;
  },
}));
