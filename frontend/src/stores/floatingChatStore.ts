// frontend/src/stores/floatingChatStore.ts
// 任务对话悬浮窗状态:多任务 tab(切 taskId)+ 最小化 + 位置/尺寸记忆(localStorage)。
// 单窗多 tab 模式(调研结论):切 tab 时窗口位置不变,只换内壳 TaskConversation;
// 位置/尺寸是浮窗整体的(非每任务),记一份即可。
//
// 性能:拖拽/缩放实时只更内存(setBounds,高频),松手才落盘(persistBounds,低频),
// 避免拖一下写几十次 localStorage 卡顿(Pointer Events 调研结论)。
import { create } from 'zustand';

export interface FloatingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// v2:升级默认尺寸(用户要求「默认大一点」),换 key 丢弃旧的 440×600 记忆。
const STORAGE_KEY = 'ai-task-flow:floating-chat-bounds:v2';
export const FLOATING_CHAT_MIN_WIDTH = 360;
export const FLOATING_CHAT_MIN_HEIGHT = 380;

/** 默认尺寸:按视口自适应并居中。SSR 无 window 时给保守值。 */
function defaultBounds(): FloatingBounds {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(720, Math.max(FLOATING_CHAT_MIN_WIDTH, Math.round(vw * 0.5)));
  const height = Math.min(860, Math.max(FLOATING_CHAT_MIN_HEIGHT, Math.round(vh * 0.82)));
  return {
    x: Math.max(16, Math.round((vw - width) / 2)),
    y: Math.max(16, Math.round((vh - height) / 2)),
    width,
    height,
  };
}

/** 读取记忆的位置/尺寸(降级默认值,坏数据不阻断) */
function loadBounds(): FloatingBounds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<FloatingBounds>;
      if (p && typeof p.width === 'number' && typeof p.height === 'number') {
        return {
          x: typeof p.x === 'number' ? p.x : 0,
          y: typeof p.y === 'number' ? p.y : 0,
          width: Math.max(FLOATING_CHAT_MIN_WIDTH, p.width),
          height: Math.max(FLOATING_CHAT_MIN_HEIGHT, p.height),
        };
      }
    }
  } catch (error) {
    // 坏 JSON/权限:位置记忆是增强非关键,降级默认值,留痕便于排查(CLAUDE.md 禁止空 catch)
    console.warn('[floatingChat] 读取位置缓存失败,用默认值', error);
  }
  return defaultBounds();
}

function saveBounds(b: FloatingBounds): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch (error) {
    // 隐私模式/配额满:忽略,下次用默认(同上,非关键降级)
    console.warn('[floatingChat] 写入位置缓存失败', error);
  }
}

interface FloatingChatState {
  /** 浮窗 tab 列表(每个 taskId 一个 tab) */
  taskIds: string[];
  /** 当前激活的 tab */
  activeTaskId: string | null;
  /** 浮窗是否展开显示(最小化时 false) */
  open: boolean;
  minimized: boolean;
  bounds: FloatingBounds;
  /** 把任务加入浮窗(已在则激活)+ 展开 */
  openTask: (taskId: string) => void;
  /** 关闭某 tab;关的是激活 tab 则切到末尾 */
  closeTask: (taskId: string) => void;
  setActive: (taskId: string) => void;
  minimize: () => void;
  restore: () => void;
  /** 高频:仅更新内存的位置/尺寸(拖拽/缩放实时用,不写盘) */
  setBounds: (b: FloatingBounds) => void;
  /** 低频:把当前 bounds 写入 localStorage(松手时调一次) */
  persistBounds: () => void;
}

export const useFloatingChatStore = create<FloatingChatState>((set, get) => ({
  taskIds: [],
  activeTaskId: null,
  open: false,
  minimized: false,
  bounds: loadBounds(),

  openTask: (taskId) =>
    set((s) => ({
      taskIds: s.taskIds.includes(taskId) ? s.taskIds : [...s.taskIds, taskId],
      activeTaskId: taskId,
      open: true,
      minimized: false,
    })),

  closeTask: (taskId) =>
    set((s) => {
      const taskIds = s.taskIds.filter((id) => id !== taskId);
      const activeTaskId =
        s.activeTaskId === taskId ? taskIds[taskIds.length - 1] ?? null : s.activeTaskId;
      // 全部 tab 关完 → 收起浮窗
      return { taskIds, activeTaskId, open: taskIds.length > 0 ? s.open : false };
    }),

  setActive: (taskId) => set({ activeTaskId: taskId }),

  minimize: () => set({ minimized: true }),

  restore: () => set({ minimized: false, open: true }),

  setBounds: (b) => set({ bounds: b }),

  persistBounds: () => saveBounds(get().bounds),
}));
