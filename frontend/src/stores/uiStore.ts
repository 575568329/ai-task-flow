// frontend/src/stores/uiStore.ts
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ai-task-flow-theme';
const GROUPS_KEY = 'ai-task-flow-collapsed-groups';

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

/** 读看板项目分组折叠态:key=projectName(或 UNGROUPED_KEY), true=收起。 */
function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCollapsedGroups(groups: Record<string, boolean>): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // 隐私模式/配额超限:静默忽略,折叠态退化为本次会话内存态
  }
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
  /** 看板列内项目分组折叠态:key=projectName(或 UNGROUPED_KEY), true=收起。localStorage 持久化。 */
  collapsedGroups: Record<string, boolean>;

  toggleTheme: () => void;
  setSelectedTask: (id: string | null) => void;
  setCreatingTask: (creating: boolean) => void;
  setProjectFilter: (project: string | null) => void;
  setSourceFilter: (source: 'web' | 'manual' | null) => void;
  setSearchQuery: (query: string) => void;
  setLocalAccess: (v: boolean) => void;
  setStorageWarn: (v: boolean) => void;
  /** 切换某个项目分组的展开/收起。 */
  toggleGroup: (key: string) => void;
  /** 收起全部给定分组。 */
  collapseAllGroups: (keys: string[]) => void;
  /** 展开全部分组(清空折叠记录)。 */
  expandAllGroups: () => void;
  /** 首次初始化(无 localStorage 记忆时):只展开 defaultOpenKey,收起其余。已初始化则不动。 */
  initGroups: (allKeys: string[], defaultOpenKey: string) => void;
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
  collapsedGroups: loadCollapsedGroups(),

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

  toggleGroup: (key) =>
    set((s) => {
      const next = { ...s.collapsedGroups };
      if (next[key]) delete next[key];
      else next[key] = true;
      saveCollapsedGroups(next);
      return { collapsedGroups: next };
    }),
  collapseAllGroups: (keys) => {
    const next: Record<string, boolean> = {};
    for (const k of keys) next[k] = true;
    saveCollapsedGroups(next);
    set({ collapsedGroups: next });
  },
  expandAllGroups: () => {
    saveCollapsedGroups({});
    set({ collapsedGroups: {} });
  },
  initGroups: (allKeys, defaultOpenKey) => {
    // 已有折叠记忆(localStorage 非空)→ 尊重用户/历史,不覆盖
    if (localStorage.getItem(GROUPS_KEY)) return;
    // 单一分组(或空)无需折叠,保持全展开
    if (allKeys.length <= 1) return;
    const next: Record<string, boolean> = {};
    for (const k of allKeys) {
      if (k !== defaultOpenKey) next[k] = true;
    }
    saveCollapsedGroups(next);
    set({ collapsedGroups: next });
  },
}));

/** 应用启动时调用一次,把初始主题挂到 <html> */
export function initTheme(): void {
  applyTheme(useUIStore.getState().theme);
}
