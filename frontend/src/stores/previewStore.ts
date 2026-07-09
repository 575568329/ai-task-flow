// frontend/src/stores/previewStore.ts
// 图片预览蒙版状态(任意 img 点击调 open(src) 触发全局 overlay)。
// 用 zustand vanilla API(usePreviewStore.getState())可在组件外(如 MessageContent 模块级 components)调用。
import { create } from 'zustand';

interface PreviewState {
  src: string | null;
  open: (src: string) => void;
  close: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  src: null,
  open: (src) => set({ src }),
  close: () => set({ src: null }),
}));
