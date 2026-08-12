// frontend/src/components/mindmap/layout.ts
// dagre 自动布局：思维导图水平树（LR 方向）。
// 思维导图典型布局：根在左、整体向右展开。dagre rankdir=LR 一行配置覆盖。
// 用 React Flow 已测量的节点尺寸（n.measured）而非硬编码，避免节点大小变化后布局错位。
import dagre from '@dagrejs/dagre';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 40;

/** 布局所需的最小节点形状（RF Node 与 shared MindmapFlowNode 均满足，泛型避免类型冲突） */
interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}
interface LayoutEdge {
  source: string;
  target: string;
}

/**
 * 用 dagre 对 nodes/edges 做水平树布局，返回带新坐标的 nodes（edges 不变）。
 * dagre 返回节点中心点，需转成 React Flow 的左上角坐标。
 */
export function getLayoutedElements<T extends LayoutNode>(
  nodes: T[],
  edges: LayoutEdge[],
  direction: 'LR' | 'TB' = 'LR',
): { nodes: T[]; edges: LayoutEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 110, // 层级间距
    nodesep: 28, // 同层节点间距
    marginx: 40,
    marginy: 40,
  });

  for (const n of nodes) {
    // 优先用 RF 实测尺寸；缺省兜底（首次布局前可能未测量）
    const measured = n.measured as { width?: number; height?: number } | undefined;
    const width = measured?.width ?? n.width ?? DEFAULT_NODE_WIDTH;
    const height = measured?.height ?? n.height ?? DEFAULT_NODE_HEIGHT;
    g.setNode(n.id, { width, height });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const layouted = nodes.map((n) => {
    const pos = g.node(n.id);
    // dagre 给的是中心点 → 转左上角
    return {
      ...n,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
    };
  });

  return { nodes: layouted, edges };
}
