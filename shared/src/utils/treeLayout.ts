// shared/src/utils/treeLayout.ts
// 自定义水平树布局（DFS），供前端编辑器与后端 MCP（create_canvas 自动布局）共用。
//
// 为什么不用 dagre：dagre 不保证同级节点的垂直顺序，导致「上移/下移/拖拽排序」
// 改了 children 顺序后重排结果不可控。自定义 DFS 按 children 数组顺序布局，
// 同级顺序 = edges 里 parent 的子边出现顺序，排序后重排即生效。
//
// 零第三方依赖（shared 包约束），纯函数。
//
// 重叠防护（v2）：
// - 列距自适应：x 不再是 depth×固定值，而是「前列最大节点宽 + RANKSEP」累计——
//   节点可换行变宽（max-w 280），固定列距会横向压住下一列
// - 父节点真垂直居中：top = 子跨度中心 - 父高/2（原来把子顶部中点当 top，
//   多行高节点向下溢出盖住子节点）
const DEFAULT_NODE_HEIGHT = 40;
const DEFAULT_NODE_WIDTH = 160; // measured 缺失（后端建图无渲染尺寸）时的保守列宽
const RANKSEP = 240; // 列间距（最宽节点之后的留白）
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
 * 未达节点（环上/无根分量）保留旧坐标。
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

  const widthOf = new Map<string, number>();
  const heightOf = new Map<string, number>();
  for (const n of nodes) {
    widthOf.set(n.id, n.measured?.width ?? n.width ?? DEFAULT_NODE_WIDTH);
    heightOf.set(n.id, n.measured?.height ?? n.height ?? DEFAULT_NODE_HEIGHT);
  }

  // Pass 1：标记每个可达节点的 depth（环安全）
  const depthOf = new Map<string, number>();
  const markDepth = (id: string, depth: number) => {
    if (depthOf.has(id)) return;
    depthOf.set(id, depth);
    for (const c of childrenOf.get(id) ?? []) markDepth(c, depth + 1);
  };
  if (rootId) markDepth(rootId, 0);

  // Pass 2：列 x = 前列最大节点宽 + RANKSEP 的累计（宽节点不再压住下一列）
  const depthMaxWidth = new Map<number, number>();
  for (const [id, d] of depthOf) {
    depthMaxWidth.set(d, Math.max(depthMaxWidth.get(d) ?? 0, widthOf.get(id) ?? 0));
  }
  const columnX = new Map<number, number>();
  let xCursor = 0;
  for (const d of [...depthMaxWidth.keys()].sort((a, b) => a - b)) {
    columnX.set(d, xCursor);
    xCursor += (depthMaxWidth.get(d) ?? 0) + RANKSEP;
  }

  // Pass 3：y 布局——叶子按顺序占 y，父节点垂直居中于子树跨度
  const positions = new Map<string, { x: number; y: number }>();
  let yCursor = 0;
  const visited = new Set<string>();
  const dfs = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const children = childrenOf.get(id) ?? [];
    const h = heightOf.get(id) ?? DEFAULT_NODE_HEIGHT;
    const firstY = yCursor;
    for (const child of children) dfs(child, depth + 1);
    if (yCursor === firstY) {
      // 无有效子（环回边或空子列表）：按叶子占位
      positions.set(id, { x: columnX.get(depth) ?? 0, y: yCursor });
      yCursor += h + NODESEP;
      return;
    }
    // 子树跨度 [firstY, lastBottom]；父 top = 中心 - 父高/2（真垂直居中，不盖子）
    const lastBottom = yCursor - NODESEP;
    positions.set(id, { x: columnX.get(depth) ?? 0, y: (firstY + lastBottom) / 2 - h / 2 });
  };

  if (rootId) dfs(rootId, 0);

  const layouted = nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });

  return { nodes: layouted, edges };
}
