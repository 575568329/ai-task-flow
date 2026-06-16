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
  /** 是否本机访问(基于 /health 的 localAccess)。false = 局域网其他设备,需屏蔽敏感页面 */
  localAccess: boolean;
  /** 存储占用是否超阈值(单项或总计),用于侧边栏设置按钮红点提示 */
  storageWarn: boolean;

  toggleTheme: () => void;
  setSelectedTask: (id: string | null) => void;
  setCreatingTask: (creating: boolean) => void;
  setProjectFilter: (project: string | null) => void;
  setSearchQuery: (query: string) => void;
  setLocalAccess: (v: boolean) => void;
  setStorageWarn: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: getInitialTheme(),
  selectedTaskId: null,
  creatingTask: false,
  projectFilter: null,
  searchQuery: '',
  // 默认 true:fetch /health 前不误屏蔽本机用户的敏感页面
  localAccess: true,
  storageWarn: false,

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
  setLocalAccess: (v) => set({ localAccess: v }),
  setStorageWarn: (v) => set({ storageWarn: v }),
}));

/** 应用启动时调用一次,把初始主题挂到 <html> */
export function initTheme(): void {
  applyTheme(useUIStore.getState().theme);
}
