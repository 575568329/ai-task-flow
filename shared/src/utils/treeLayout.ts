// shared/src/utils/treeLayout.ts
// 自定义水平树布局（DFS），供前端编辑器与后端 MCP（create_canvas 自动布局）共用。
//
// 为什么不用 dagre：dagre 不保证同级节点的垂直顺序，导致「上移/下移/拖拽排序」
// 改了 children 顺序后重排结果不可控。自定义 DFS 按 children 数组顺序布局，
// 同级顺序 = edges 里 parent 的子边出现顺序，排序后重排即生效。
//
// 零第三方依赖（shared 包约束），纯函数。
const DEFAULT_NODE_HEIGHT = 40;
const RANKSEP = 240; // 层级水平间距（根在左，子向右）
const NODESEP = 16; // 同级垂直间距

/** 布局所需的最小节点形状（RF Node 与 shared MindmapFlowNode 均满足，泛型避免类型冲突） */
export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}
export interface LayoutEdge {
  source: string;
  target: string;
}

/**
 * 自定义水平树布局。返回带新坐标的 nodes（edges 不变）。
 * 同级节点的垂直顺序 = parent 的子边在 edges 中的出现顺序（排序时改 edges 顺序即可）。
 */
export function getLayoutedElements<T extends LayoutNode>(
  nodes: T[],
  edges: LayoutEdge[],
  _direction: 'LR' | 'TB' = 'LR',
): { nodes: T[]; edges: LayoutEdge[] } {
  if (nodes.length === 0) return { nodes, edges };

  // childrenOf 的顺序 = edges 里 filter(source=parent) 的出现顺序（排序依据）
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }

  // root = 无入边的节点
  const hasParent = new Set(edges.map((e) => e.target));
  const rootId = nodes.find((n) => !hasParent.has(n.id))?.id;

  const nodeHeightOf = (id: string): number => {
    const n = nodes.find((x) => x.id === id);
    return n?.measured?.height ?? n?.height ?? DEFAULT_NODE_HEIGHT;
  };

  const positions = new Map<string, { x: number; y: number }>();
  let yCursor = 0;

  // DFS：叶子按顺序占 y，父居中于首尾子的 y 中点
  const dfs = (id: string, depth: number) => {
    const children = childrenOf.get(id) ?? [];
    const h = nodeHeightOf(id);
    if (children.length === 0) {
      positions.set(id, { x: depth * RANKSEP, y: yCursor });
      yCursor += h + NODESEP;
      return;
    }
    const firstY = yCursor;
    for (const child of children) dfs(child, depth + 1);
    const lastY = yCursor - NODESEP - nodeHeightOf(children[children.length - 1]);
    positions.set(id, { x: depth * RANKSEP, y: (firstY + lastY) / 2 });
  };

  if (rootId) dfs(rootId, 0);

  const layouted = nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });

  return { nodes: layouted, edges };
}
