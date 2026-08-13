// frontend/src/components/mindmap/useUndoRedo.ts
// 撤销/重做快照栈。按"编辑事务"粒度记录（增删/编辑/拖拽停/布局/折叠），上限 50 步。
// 用法：变更前 takeSnapshot() 记录当前态；undo/redo 在 past/future 栈间切换。
import { useState, useCallback } from 'react';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';

export interface MindmapSnapshot {
  nodes: MindmapRFNode[];
  edges: MindmapRFEdge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(opts: {
  getLatest: () => MindmapSnapshot;
  setNodes: (n: MindmapRFNode[]) => void;
  setEdges: (e: MindmapRFEdge[]) => void;
  markDirty: () => void;
}) {
  const { getLatest, setNodes, setEdges, markDirty } = opts;
  const [past, setPast] = useState<MindmapSnapshot[]>([]);
  const [future, setFuture] = useState<MindmapSnapshot[]>([]);

  /** 记录当前态到 past（在事务变更前调用），清空 future（新分支丢弃 redo 链） */
  const takeSnapshot = useCallback(() => {
    const cur = getLatest();
    setPast((p) => {
      const next = [...p, clone(cur)];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setFuture([]);
  }, [getLatest]);

  const undo = useCallback(() => {
    if (past.length === 0) return false;
    const prev = past[past.length - 1];
    setFuture((f) => [...f, clone(getLatest())]);
    setPast((p) => p.slice(0, -1));
    setNodes(prev.nodes);
    setEdges(prev.edges);
    markDirty();
    return true;
  }, [past, getLatest, setNodes, setEdges, markDirty]);

  const redo = useCallback(() => {
    if (future.length === 0) return false;
    const next = future[future.length - 1];
    setPast((p) => [...p, clone(getLatest())]);
    setFuture((f) => f.slice(0, -1));
    setNodes(next.nodes);
    setEdges(next.edges);
    markDirty();
    return true;
  }, [future, getLatest, setNodes, setEdges, markDirty]);

  return {
    takeSnapshot,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

/** 深拷贝（优先 structuredClone，降级 JSON） */
function clone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}
