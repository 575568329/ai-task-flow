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
  /** 以「创建模式」打开任务抽屉(空表单 + Markdown 预览) */
  creatingTask: boolean;
  projectFilter: string | null;
  searchQuery: string;

  toggleTheme: () => void;
  setSelectedTask: (id: string | null) => void;
  setCreatingTask: (creating: boolean) => void;
  setProjectFilter: (project: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: getInitialTheme(),
  selectedTaskId: null,
  creatingTask: false,
  projectFilter: null,
  searchQuery: '',

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  // 选中已有任务时,关闭创建模式,二者互斥
  setSelectedTask: (id) => set({ selectedTaskId: id, creatingTask: id ? false : get().creatingTask }),
  setCreatingTask: (creating) => set({ creatingTask: creating, selectedTaskId: creating ? null : get().selectedTaskId }),
  setProjectFilter: (project) => set({ projectFilter: project }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));

/** 应用启动时调用一次,把初始主题挂到 <html> */
export function initTheme(): void {
  applyTheme(useUIStore.getState().theme);
}
