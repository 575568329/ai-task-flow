// frontend/src/stores/mindmapStore.ts
// 思维导图文档级状态：列表 / 当前文档 meta / 画布草稿 / dirty / 保存状态。
//
// 【关键架构】nodes/edges 不进本 store（高频编辑态由 MindmapEditor 本地 useState 持有，
// 避免拖动每像素触发全局 re-render）。本 store 只管文档级：
//   - list / current(含 version 乐观锁基准) / draft(keep-alive 卸载暂存) / isDirty / saveStatus
// Editor 通过 markDirty/onSaved/setDraft 与 store 双向同步。
import { create } from 'zustand';
import type {
  MindmapDocDTO,
  MindmapFlowEdge,
  MindmapFlowNode,
  MindmapMetaDTO,
  MindmapViewport,
} from '@ai-task-flow/shared';
import { mindmapApi } from '@/api/mindmap';

export type MindmapSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** 画布草稿：keep-alive 卸载画布时暂存编辑态，切回重建（不丢未保存编辑） */
export interface MindmapDraft {
  nodes: MindmapFlowNode[];
  edges: MindmapFlowEdge[];
  viewport?: MindmapViewport;
}

interface MindmapState {
  // 列表态
  list: MindmapMetaDTO[];
  listLoading: boolean;
  // 当前编辑文档（含 version 供乐观锁基准；nodes/edges 仅初始加载用，编辑态在 editor 本地）
  current: MindmapDocDTO | null;
  currentLoading: boolean;
  // 画布暂存（卸载时存，重挂载时取；为 null 表示从 current 重新加载）
  draft: MindmapDraft | null;
  isDirty: boolean;
  saveStatus: MindmapSaveStatus;

  // 列表
  fetchList: () => Promise<void>;
  // 文档生命周期
  createDoc: (title?: string) => Promise<string | null>;
  openDoc: (id: string) => Promise<void>;
  closeDoc: () => void;
  deleteDoc: (id: string) => Promise<void>;
  duplicateDoc: (id: string) => Promise<string | null>;
  renameCurrent: (title: string) => Promise<void>;

  // 画布 ↔ store 桥（editor 调用）
  setDraft: (d: MindmapDraft | null) => void;
  markDirty: () => void;
  setSaveStatus: (s: MindmapSaveStatus) => void;
  /** 保存成功后更新 version 基准 + 清 dirty */
  onSaved: (newVersion: number) => void;
  /** 自动布局信号（Toolbar 点击 → tick++ → editor effect 执行 dagre 布局） */
  autoLayoutTick: number;
  triggerAutoLayout: () => void;
}

export const useMindmapStore = create<MindmapState>((set, get) => ({
  list: [],
  listLoading: false,
  current: null,
  currentLoading: false,
  draft: null,
  isDirty: false,
  saveStatus: 'idle',
  autoLayoutTick: 0,

  fetchList: async () => {
    set({ listLoading: true });
    try {
      const res = await mindmapApi.list();
      set({ list: res.items });
    } catch {
      /* http toast */
    } finally {
      set({ listLoading: false });
    }
  },

  createDoc: async (title) => {
    try {
      const doc = await mindmapApi.create({ title });
      set({ current: doc, draft: null, isDirty: false, saveStatus: 'idle' });
      await get().fetchList();
      return doc.id;
    } catch {
      return null;
    }
  },

  openDoc: async (id) => {
    set({ currentLoading: true });
    try {
      const doc = await mindmapApi.get(id);
      set({ current: doc, draft: null, isDirty: false, saveStatus: 'idle' });
    } catch {
      /* http toast */
    } finally {
      set({ currentLoading: false });
    }
  },

  closeDoc: () => set({ current: null, draft: null, isDirty: false, saveStatus: 'idle' }),

  deleteDoc: async (id) => {
    try {
      await mindmapApi.remove(id);
      set((s) => ({
        list: s.list.filter((m) => m.id !== id),
        current: s.current?.id === id ? null : s.current,
        draft: s.current?.id === id ? null : s.draft,
      }));
    } catch {
      /* http toast */
    }
  },

  duplicateDoc: async (id) => {
    try {
      const doc = await mindmapApi.duplicate(id);
      await get().fetchList();
      return doc.id;
    } catch {
      return null;
    }
  },

  renameCurrent: async (title) => {
    const cur = get().current;
    if (!cur) return;
    try {
      const updated = await mindmapApi.update(cur.id, { title, expectedVersion: cur.version });
      set({ current: { ...cur, ...updated } });
      await get().fetchList();
    } catch {
      /* http toast（409 冲突等） */
    }
  },

  setDraft: (d) => set({ draft: d }),
  markDirty: () => set({ isDirty: true }),
  setSaveStatus: (s) => set({ saveStatus: s }),
  onSaved: (newVersion) =>
    set((s) => ({
      isDirty: false,
      saveStatus: 'saved',
      current: s.current ? { ...s.current, version: newVersion } : s.current,
    })),
  triggerAutoLayout: () => set((s) => ({ autoLayoutTick: s.autoLayoutTick + 1 })),
}));
