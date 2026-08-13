// frontend/src/stores/uiStore.ts
// UI 全局状态:主题 / 任务选中 / 创建模式 / 筛选 / 安全标志 / 设置弹窗。
// P2-22:看板分组折叠态(collapsedGroups)已拆到 boardGroupingStore,本 store 职责收敛。
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ai-task-flow-theme';
const NIGHT_MODE_KEY = 'ai-task-flow-night-mode';

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

/** 读夜间开发模式开关:默认关闭(安全默认),仅 'true' 才视为开启,脏数据兜底为 false */
function getInitialNightMode(): boolean {
  return localStorage.getItem(NIGHT_MODE_KEY) === 'true';
}

interface UIState {
  theme: Theme;
  selectedTaskId: string | null;
  /** 以「创建模式」打开任务抽屉(空表单 + Markdown 预览) */
  creatingTask: boolean;
  projectFilter: string | null;
  sourceFilter: 'web' | 'manual' | null;
  searchQuery: string;
  /** 是否本机访问(基于 /health 的 localAccess)。false = 局域网其他设备,需屏蔽敏感页面 */
  localAccess: boolean;
  /** 存储占用是否超阈值(单项或总计),用于侧边栏设置按钮红点提示 */
  storageWarn: boolean;
  /** 夜间开发模式:开启后「打开终端」启动的 claude 跳过所有权限确认(--permission-mode bypassPermissions)。
   *  仅本机可信隔离环境使用。localStorage 持久化,默认关闭。 */
  nightMode: boolean;

  toggleTheme: () => void;
  setSelectedTask: (id: string | null) => void;
  setCreatingTask: (creating: boolean) => void;
  setProjectFilter: (project: string | null) => void;
  setSourceFilter: (source: 'web' | 'manual' | null) => void;
  setSearchQuery: (query: string) => void;
  setLocalAccess: (v: boolean) => void;
  setStorageWarn: (v: boolean) => void;
  /** 设置夜间开发模式(同时持久化到 localStorage)。 */
  setNightMode: (v: boolean) => void;
  /** 设置弹窗开关 + 初始 tab(供任意组件打开,如生词本页「连接墨墨」跳 maimemo tab) */
  settingsOpen: boolean;
  settingsTab: string | null;
  setSettingsOpen: (open: boolean) => void;
  openSettings: (tab?: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: getInitialTheme(),
  selectedTaskId: null,
  creatingTask: false,
  projectFilter: null,
  sourceFilter: null,
  searchQuery: '',
  // 默认 true:fetch /health 前不误屏蔽本机用户的敏感页面
  localAccess: true,
  storageWarn: false,
  nightMode: getInitialNightMode(),

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
  setSourceFilter: (source) => set({ sourceFilter: source }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLocalAccess: (v) => set({ localAccess: v }),
  setStorageWarn: (v) => set({ storageWarn: v }),
  setNightMode: (v) => {
    localStorage.setItem(NIGHT_MODE_KEY, String(v));
    set({ nightMode: v });
  },

  settingsOpen: false,
  settingsTab: null,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? null }),
}));

/** 应用启动时调用一次,把初始主题挂到 <html> */
export function initTheme(): void {
  applyTheme(useUIStore.getState().theme);
}
