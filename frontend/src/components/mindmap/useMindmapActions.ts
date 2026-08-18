// frontend/src/components/mindmap/useMindmapActions.ts
// 思维导图节点操作：加子/加同级/删子树/折叠展开。
// 用 getLatest() 读最新 nodes/edges（闭包不过期），操作后统一 applyHidden 重算隐藏态。
import { useCallback } from 'react';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';

interface LatestState {
  nodes: MindmapRFNode[];
  edges: MindmapRFEdge[];
}

export interface MindmapActions {
  addChildNode: (parentId: string) => void;
  addSiblingNode: (siblingId: string) => void;
  deleteNode: (id: string) => void;
  toggleExpand: (id: string) => void;
  promoteNode: (id: string) => void;
  demoteNode: (id: string) => void;
  moveSibling: (id: string, direction: 'up' | 'down') => void;
}

/** 计算应隐藏的节点 id 集合（所有 collapsed 节点的后代）。导出供测试 */
export function computeHidden(nodes: MindmapRFNode[], edges: MindmapRFEdge[]): Set<string> {
  const hidden = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }
  const stack: string[] = [];
  for (const n of nodes) {
    // expanded 缺省视为 true；collapsed 的节点把直接子节点入栈
    if (!(n.data.expanded ?? true) && childrenOf.has(n.id)) {
      stack.push(...childrenOf.get(n.id)!);
    }
  }
  while (stack.length) {
    const id = stack.pop()!;
    if (hidden.has(id)) continue;
    hidden.add(id);
    if (childrenOf.has(id)) stack.push(...childrenOf.get(id)!);
  }
  return hidden;
}

/** 按 expanded 状态重算并写入 hidden（折叠子树隐藏节点 + 关联边）。导出供测试 */
export function applyHidden(nodes: MindmapRFNode[], edges: MindmapRFEdge[]) {
  const hidden = computeHidden(nodes, edges);
  return {
    nodes: nodes.map((n) => ({ ...n, hidden: hidden.has(n.id) || undefined })),
    edges: edges.map((e) => ({
      ...e,
      hidden: hidden.has(e.source) || hidden.has(e.target) || undefined,
    })),
  };
}

/**
 * 递归调整 rootId 及其所有后代的 level（±delta）。
 * promote/demote 时保持子树内相对层级（字号/粗细/线宽由 level 驱动）。
 * 导出供测试。
 */
export function adjustSubtreeLevel(
  nodes: MindmapRFNode[],
  edges: MindmapRFEdge[],
  rootId: string,
  delta: number,
): MindmapRFNode[] {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (ids.has(cur)) continue;
    ids.add(cur);
    stack.push(...(childrenOf.get(cur) ?? []));
  }
  return nodes.map((n) =>
    ids.has(n.id)
      ? { ...n, data: { ...n.data, level: Math.max(0, (n.data.level ?? 1) + delta) } }
      : n,
  );
}

export function useMindmapActions(params: {
  setNodes: React.Dispatch<React.SetStateAction<MindmapRFNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<MindmapRFEdge[]>>;
  getLatest: () => LatestState;
  markDirty: () => void;
  triggerSave: () => void;
}): MindmapActions {
  const { setNodes, setEdges, getLatest, markDirty, triggerSave } = params;

  /** 加子节点：新建 level+1 子节点 + 连边，继承父分支色，自动选中（便于连击编辑） */
  const addChildNode = useCallback(
    (parentId: string) => {
      const { nodes, edges } = getLatest();
      const parent = nodes.find((n) => n.id === parentId);
      if (!parent) return;
      const newId = crypto.randomUUID();
      const branch = parent.data.branch ?? 'blue';
      const child: MindmapRFNode = {
        id: newId,
        type: 'mindmap',
        position: { x: parent.position.x + 220, y: parent.position.y + 40 },
        data: { label: '', level: (parent.data.level ?? 0) + 1, expanded: true, branch },
        selected: true,
      };
      const newEdge: MindmapRFEdge = {
        id: crypto.randomUUID(),
        source: parentId,
        target: newId,
        type: 'mindmap',
        // 右出左进（树形约定），线锚定在连接点上
        sourceHandle: 'right',
        targetHandle: 'left',
        data: { branch },
      };
      const cleared = nodes.map((n) => ({ ...n, selected: false }));
      const result = applyHidden([...cleared, child], [...edges, newEdge]);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /** 加同级节点：找父边，新节点作为父的另一个子 */
  const addSiblingNode = useCallback(
    (siblingId: string) => {
      const { nodes, edges } = getLatest();
      const sibling = nodes.find((n) => n.id === siblingId);
      if (!sibling || (sibling.data.level ?? 1) === 0) return; // 根无同级
      const parentEdge = edges.find((e) => e.target === siblingId);
      const newId = crypto.randomUUID();
      const sib: MindmapRFNode = {
        id: newId,
        type: 'mindmap',
        position: { x: sibling.position.x, y: sibling.position.y + 60 },
        data: {
          label: '',
          level: sibling.data.level,
          expanded: true,
          branch: sibling.data.branch,
        },
        selected: true,
      };
      const newEdges = [...edges];
      if (parentEdge) {
        newEdges.push({
          id: crypto.randomUUID(),
          source: parentEdge.source,
          target: newId,
          type: 'mindmap',
          sourceHandle: 'right',
          targetHandle: 'left',
          data: sibling.data.branch ? { branch: sibling.data.branch } : undefined,
        });
      }
      const cleared = nodes.map((n) => ({ ...n, selected: false }));
      const result = applyHidden([...cleared, sib], newEdges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /** 删除节点及其全部后代（递归），根节点不可删 */
  const deleteNode = useCallback(
    (id: string) => {
      const { nodes, edges } = getLatest();
      const target = nodes.find((n) => n.id === id);
      if (!target || (target.data.level ?? 1) === 0) return; // 不删根
      const toDelete = new Set<string>([id]);
      const childrenOf = new Map<string, string[]>();
      for (const e of edges) {
        if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
        childrenOf.get(e.source)!.push(e.target);
      }
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of childrenOf.get(cur) ?? []) {
          if (!toDelete.has(c)) {
            toDelete.add(c);
            stack.push(c);
          }
        }
      }
      const remainingNodes = nodes.filter((n) => !toDelete.has(n.id));
      const remainingEdges = edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
      const result = applyHidden(remainingNodes, remainingEdges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /** 折叠/展开：翻转 expanded，重算后代 hidden */
  const toggleExpand = useCallback(
    (id: string) => {
      const { nodes, edges } = getLatest();
      const toggled = nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, expanded: !(n.data.expanded ?? true) } } : n,
      );
      const result = applyHidden(toggled, edges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /**
   * 提升一级：node 从 parent 下移到 grandparent 下（改 edge 的 source）。
   * root 或父是 root（无 grandparent）不可提升。子树 level -1。
   */
  const promoteNode = useCallback(
    (id: string) => {
      const { nodes, edges } = getLatest();
      const parentEdge = edges.find((e) => e.target === id);
      if (!parentEdge) return; // root 无父
      const grandEdge = edges.find((e) => e.target === parentEdge.source);
      if (!grandEdge) return; // 父是 root，无 grandparent
      const newEdges = edges.map((e) =>
        e.id === parentEdge.id ? { ...e, source: grandEdge.source } : e,
      );
      const adjusted = adjustSubtreeLevel(nodes, newEdges, id, -1);
      const result = applyHidden(adjusted, newEdges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /**
   * 降级一级：node 从 parent 下移到「前一个兄弟」下（改 edge 的 source）。
   * 第一个子（无前兄弟）不可降级。子树 level +1。
   */
  const demoteNode = useCallback(
    (id: string) => {
      const { nodes, edges } = getLatest();
      const parentEdge = edges.find((e) => e.target === id);
      if (!parentEdge) return; // root
      const siblingEdges = edges.filter((e) => e.source === parentEdge.source);
      const idx = siblingEdges.findIndex((e) => e.target === id);
      if (idx <= 0) return; // 第一个子或未找到 → 无前兄弟
      const prevSiblingId = siblingEdges[idx - 1].target;
      const newEdges = edges.map((e) =>
        e.id === parentEdge.id ? { ...e, source: prevSiblingId } : e,
      );
      const adjusted = adjustSubtreeLevel(nodes, newEdges, id, 1);
      const result = applyHidden(adjusted, newEdges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  /**
   * 上移/下移：在父的 children 里交换相邻顺序（改 edges 顺序）。
   * 配合自定义树布局（按 children 顺序排），重排后顺序立即生效。
   */
  const moveSibling = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const { nodes, edges } = getLatest();
      const parentEdge = edges.find((e) => e.target === id);
      if (!parentEdge) return; // root 无兄弟
      const parentId = parentEdge.source;
      const parentEdges = edges.filter((e) => e.source === parentId);
      const otherEdges = edges.filter((e) => e.source !== parentId);
      const idx = parentEdges.findIndex((e) => e.target === id);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= parentEdges.length) return;
      const newParentEdges = [...parentEdges];
      [newParentEdges[idx], newParentEdges[swapIdx]] = [
        newParentEdges[swapIdx],
        newParentEdges[idx],
      ];
      const newEdges = [...otherEdges, ...newParentEdges];
      const result = applyHidden(nodes, newEdges);
      setNodes(result.nodes);
      setEdges(result.edges);
      markDirty();
      triggerSave();
    },
    [getLatest, setNodes, setEdges, markDirty, triggerSave],
  );

  return {
    addChildNode,
    addSiblingNode,
    deleteNode,
    toggleExpand,
    promoteNode,
    demoteNode,
    moveSibling,
  };
}
