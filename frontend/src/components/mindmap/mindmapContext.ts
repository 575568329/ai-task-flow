// frontend/src/components/mindmap/mindmapContext.ts
// 画布 ↔ 节点 的回调桥。
// 为什么用 Context 而非塞进 node.data：React.memo 浅比较 data，若把回调放 data，
// 每次父组件渲染 data 都是新引用 → memo 失效 → 所有节点重渲染（性能红线）。
// Context 让节点拿回调的同时，data 保持稳定引用。
import { createContext, useContext } from 'react';
import type { MindmapNodeData } from '@ai-task-flow/shared';

export interface MindmapEditorContextValue {
  /** 更新节点 data（label/note/branch 等） */
  updateNodeData: (id: string, patch: Partial<MindmapNodeData>) => void;
}

export const MindmapEditorContext = createContext<MindmapEditorContextValue | null>(null);

export function useMindmapEditor(): MindmapEditorContextValue {
  const ctx = useContext(MindmapEditorContext);
  if (!ctx) throw new Error('useMindmapEditor 必须在 MindmapEditorContext.Provider 内使用');
  return ctx;
}
