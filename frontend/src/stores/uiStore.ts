// frontend/src/stores/uiStore.ts
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ai-task-flow-theme';

function getInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  // 跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 把主题应用到 <html> 的 class 上 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

interface UIState {
  theme: Theme;
  selectedTaskId: string | null;
  createModalOpen: boolean;
  projectFilter: string | null;
  searchQuery: string;

  toggleTheme: () => void;
  setSelectedTask: (id: string | null) => void;
  setCreateModalOpen: (open: boolean) => void;
  setProjectFilter: (project: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: getInitialTheme(),
  selectedTaskId: null,
  createModalOpen: false,
  projectFilter: null,
  searchQuery: '',

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  setSelectedTask: (id) => set({ selectedTaskId: id }),
  setCreateModalOpen: (open) => set({ createModalOpen: open }),
  setProjectFilter: (project) => set({ projectFilter: project }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));

/** 应用启动时调用一次,把初始主题挂到 <html> */
export function initTheme(): void {
  applyTheme(useUIStore.getState().theme);
}
