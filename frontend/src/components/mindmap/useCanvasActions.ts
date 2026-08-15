// frontend/src/components/mindmap/useCanvasActions.ts
// 自由画布操作：双击空白建节点 / 删选中节点+连带边 / 删选中连线。
// 与 useMindmapActions（树形：删子树/层级/折叠）分流——自由画布无树形语义，
// 删除只删选中节点本身并清理其关联边，避免"按 Delete 删了一大片"。
import { useCallback } from 'react';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';
import { queueAutoEdit } from './autoEditQueue';

interface LatestState {
  nodes: MindmapRFNode[];
  edges: MindmapRFEdge[];
}

/** 判断文档是否是树形结构：存在根（无入边节点）且每个节点入度 ≤ 1。
 *  树形文档用 useMindmapActions 语义（Tab/Enter/删子树），自由画布用 useCanvasActions。
 *  导出供测试。 */
export function isTreeDocument(nodes: MindmapRFNode[], edges: MindmapRFEdge[]): boolean {
  if (nodes.length === 0) return false;
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  // 任一节点入度 >1（多父）→ 非树
  for (const deg of inDegree.values()) {
    if (deg > 1) return false;
  }
  // 存在无入边的节点才算树（全连通环不是树）
  return nodes.some((n) => !inDegree.has(n.id));
}

/** 删除节点集合 + 连带边（自由画布语义：只删选中，不删子树）。导出供测试。 */
export function removeNodesWithEdges(
  nodes: MindmapRFNode[],
  edges: MindmapRFEdge[],
  ids: string[],
): { nodes: MindmapRFNode[]; edges: MindmapRFEdge[] } {
  const idSet = new Set(ids);
  return {
    nodes: nodes.filter((n) => !idSet.has(n.id)),
    edges: edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
  };
}

export interface CanvasActions {
  /** 双击空白建文字节点（自动进入编辑） */
  createTextAt: (position: { x: number; y: number }) => void;
  /** 删除节点集合 + 连带边 */
  deleteNodes: (ids: string[]) => void;
  /** 删除选中的节点 + 选中的连线（单事务：一次快照一次保存） */
  deleteSelection: () => void;
}

export function useCanvasActions(params: {
  setNodes: React.Dispatch<React.SetStateAction<MindmapRFNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<MindmapRFEdge[]>>;
  getLatest: () => LatestState;
  markDirty: () => void;
  triggerSave: () => void;
  takeSnapshot: () => void;
}): CanvasActions {
  const { setNodes, setEdges, getLatest, markDirty, triggerSave, takeSnapshot } = params;

  /** 双击空白建节点：不设 level/branch（自由画布无层级），登记自动编辑 */
  const createTextAt = useCallback(
    (position: { x: number; y: number }) => {
      takeSnapshot();
      const { nodes } = getLatest();
      const newId = crypto.randomUUID();
      const node: MindmapRFNode = {
        id: newId,
        type: 'mindmap',
        position,
        data: { label: '' },
        selected: true,
      };
      const cleared = nodes.map((n) => ({ ...n, selected: false }));
      setNodes([...cleared, node]);
      queueAutoEdit(newId);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, markDirty, triggerSave, takeSnapshot],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      takeSnapshot();
      const { nodes, edges } = getLatest();
      const result = removeNodesWithEdges(nodes, edges, ids);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave, takeSnapshot],
  );

  const deleteSelection = useCallback(() => {
    const { nodes, edges } = getLatest();
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const idSet = new Set(selectedIds);
    const keepEdges = edges.filter((e) => !e.selected && !idSet.has(e.source) && !idSet.has(e.target));
    if (selectedIds.length === 0 && keepEdges.length === edges.length) return; // 无选中
    takeSnapshot();
    setNodes(nodes.filter((n) => !idSet.has(n.id)));
    setEdges(keepEdges);
    markDirty();
    triggerSave();
  }, [getLatest, setNodes, setEdges, markDirty, triggerSave, takeSnapshot]);

  return { createTextAt, deleteNodes, deleteSelection };
}
