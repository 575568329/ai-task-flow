// frontend/src/stores/maimemoStore.ts
// 墨墨同步状态：脱敏配置 + 同步进行态 + 学习进度（5min 缓存由后端管，前端仅持有最近一次）。
import { create } from 'zustand';
import { maimemoApi } from '@/api/maimemo';
import { toast } from '@/components/ui/toaster';
import type {
  MaimemoConfigDTO,
  MaimemoTestResultDTO,
  StudySyncResultDTO,
  NotepadSyncResultDTO,
  StudyProgressDTO,
} from '@ai-task-flow/shared';

interface MaimemoState {
  config: MaimemoConfigDTO | null;
  loading: boolean;
  saving: boolean;
  testing: boolean;
  /** 任一同步进行中（云词本 / 学习计划互斥，避免双写） */
  syncingNotepad: boolean;
  syncingStudy: boolean;
  progress: StudyProgressDTO | null;
  loadingProgress: boolean;

  fetchConfig: () => Promise<MaimemoConfigDTO | null>;
  saveConfig: (token: string) => Promise<boolean>;
  testConnection: () => Promise<MaimemoTestResultDTO | null>;
  syncNotepad: () => Promise<NotepadSyncResultDTO | null>;
  syncStudy: () => Promise<StudySyncResultDTO | null>;
  fetchProgress: (force?: boolean) => Promise<StudyProgressDTO | null>;
  /** 轻量判断是否已配置（供页面决定显示同步入口 or 连接墨墨） */
  isConfigured: () => boolean;
}

export const useMaimemoStore = create<MaimemoState>((set, get) => ({
  config: null,
  loading: false,
  saving: false,
  testing: false,
  syncingNotepad: false,
  syncingStudy: false,
  progress: null,
  loadingProgress: false,

  isConfigured: () => !!get().config?.tokenSet,

  fetchConfig: async () => {
    set({ loading: true });
    try {
      const config = await maimemoApi.getConfig();
      set({ config });
      return config;
    } catch {
      return null;
    } finally {
      set({ loading: false });
    }
  },

  saveConfig: async (token) => {
    set({ saving: true });
    try {
      const config = await maimemoApi.saveConfig({ token });
      set({ config });
      toast.success('墨墨 token 已保存');
      return true;
    } catch {
      return false;
    } finally {
      set({ saving: false });
    }
  },

  testConnection: async () => {
    set({ testing: true });
    try {
      const result = await maimemoApi.test();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      return result;
    } catch {
      return null;
    } finally {
      set({ testing: false });
    }
  },

  syncNotepad: async () => {
    set({ syncingNotepad: true });
    try {
      const result = await maimemoApi.syncNotepad();
      toast.success(`已${result.created ? '创建' : '更新'}墨墨云词本（${result.count} 词）`);
      // 同步后刷新配置（更新 lastNotepadSyncAt）+ 进度
      await get().fetchConfig();
      return result;
    } catch {
      return null;
    } finally {
      set({ syncingNotepad: false });
    }
  },

  syncStudy: async () => {
    set({ syncingStudy: true });
    try {
      const result = await maimemoApi.syncStudy();
      if (result.failed > 0) {
        toast.error(`已加入 ${result.synced} 词，${result.failed} 词失败${result.notFound ? `（含 ${result.notFound} 词墨墨未收录）` : ''}`);
      } else {
        toast.success(`已加入学习计划 ${result.synced} 词`);
      }
      return result;
    } catch {
      return null;
    } finally {
      set({ syncingStudy: false });
    }
  },

  fetchProgress: async (force = false) => {
    set({ loadingProgress: true });
    try {
      const progress = await maimemoApi.getProgress(force);
      set({ progress });
      return progress;
    } catch {
      return null;
    } finally {
      set({ loadingProgress: false });
    }
  },
}));
