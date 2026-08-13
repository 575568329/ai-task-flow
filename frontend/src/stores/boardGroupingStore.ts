// frontend/src/stores/boardGroupingStore.ts
// 看板项目分组折叠态(P2-22:从 uiStore 拆出,单一职责——uiStore 原塞了主题/选中/筛选/
// 安全标志/设置等过多关注点)。key=projectName(或 UNGROUPED_KEY),true=收起。localStorage 持久化。
import { create } from 'zustand';

const GROUPS_KEY = 'ai-task-flow-collapsed-groups';

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

interface BoardGroupingState {
  collapsedGroups: Record<string, boolean>;
  /** 切换某个项目分组的展开/收起 */
  toggleGroup: (key: string) => void;
  /** 收起全部给定分组 */
  collapseAllGroups: (keys: string[]) => void;
  /** 展开全部分组(清空折叠记录) */
  expandAllGroups: () => void;
  /** 首次初始化(无 localStorage 记忆时):只展开 defaultOpenKey,收起其余。已初始化则不动 */
  initGroups: (allKeys: string[], defaultOpenKey: string) => void;
}

export const useBoardGroupingStore = create<BoardGroupingState>((set) => ({
  collapsedGroups: loadCollapsedGroups(),

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
