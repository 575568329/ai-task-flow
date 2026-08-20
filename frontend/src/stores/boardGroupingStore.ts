// frontend/src/stores/boardGroupingStore.ts
// 看板折叠记忆(单一职责,uiStore 不塞看板关注点):
// - collapsedGroups:key=projectName(或 UNGROUPED_KEY),true=收起
// - rowCollapsed:紧凑行形态下按任务状态的整行收起(手动操作才有记录)
// 均 localStorage 持久化。行收起收口在此 store:此前 KanbanColumn 各列实例
// 各持 useState 副本,先后折叠会整表互相覆盖(审阅发现的记忆丢失 bug)。
import { create } from 'zustand';

const GROUPS_KEY = 'ai-task-flow-collapsed-groups';
const ROW_KEY = 'ai-task-flow:board-row-collapsed:v1';

/** 解析记录型 localStorage,防御 null/非对象(坏数据会让布尔查表抛 TypeError 白屏) */
function loadRecord(raw: string | null): Record<string, boolean> {
  try {
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function saveRecord(key: string, value: Record<string, boolean>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式/配额超限:静默忽略,退化为本次会话内存态
  }
}

interface BoardGroupingState {
  collapsedGroups: Record<string, boolean>;
  /** 紧凑行形态:用户手动设置的整行收起(按状态;默认策略在组件层:记忆 ?? 空行收起) */
  rowCollapsed: Record<string, boolean>;
  /** 切换某个项目分组的展开/收起 */
  toggleGroup: (key: string) => void;
  /** 收起全部给定分组 */
  collapseAllGroups: (keys: string[]) => void;
  /** 展开全部分组(清空折叠记录) */
  expandAllGroups: () => void;
  /** 首次初始化(无 localStorage 记忆时):只展开 defaultOpenKey,收起其余。已初始化则不动 */
  initGroups: (allKeys: string[], defaultOpenKey: string) => void;
  /** 设置某状态行的手动收起值(true/false);全列共享同一 store,无覆盖竞态 */
  setRowCollapsed: (status: string, collapsed: boolean) => void;
}

export const useBoardGroupingStore = create<BoardGroupingState>((set) => ({
  collapsedGroups: loadRecord(localStorage.getItem(GROUPS_KEY)),
  rowCollapsed: loadRecord(localStorage.getItem(ROW_KEY)),

  toggleGroup: (key) =>
    set((s) => {
      const next = { ...s.collapsedGroups };
      if (next[key]) delete next[key];
      else next[key] = true;
      saveRecord(GROUPS_KEY, next);
      return { collapsedGroups: next };
    }),

  collapseAllGroups: (keys) => {
    const next: Record<string, boolean> = {};
    for (const k of keys) next[k] = true;
    saveRecord(GROUPS_KEY, next);
    set({ collapsedGroups: next });
  },

  expandAllGroups: () => {
    saveRecord(GROUPS_KEY, {});
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
    saveRecord(GROUPS_KEY, next);
    set({ collapsedGroups: next });
  },

  setRowCollapsed: (status, collapsed) =>
    set((s) => {
      const next = { ...s.rowCollapsed, [status]: collapsed };
      saveRecord(ROW_KEY, next);
      return { rowCollapsed: next };
    }),
}));
