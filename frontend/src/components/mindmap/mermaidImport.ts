// frontend/src/components/mindmap/mermaidImport.ts
// Mermaid flowchart 子集解析器（零依赖，自写——不引 mermaid 包，可测性最好）。
//
// 支持的语法子集（覆盖手写流程图 90% 场景）：
// - 头行：flowchart/graph + 任意方向（LR/RL/TD/TB，方向忽略，导入后走画布 DFS 布局）
// - 节点：裸 id、id[矩形]、id(圆角)、id{菱形}（形状忽略，统一矩形卡片，取文本）
// - 边：-->、---、-.->、==> （箭头样式忽略，统一无箭头曲线），可选 |边标签|
// - 链式：A --> B --> C；环、多父、孤立节点天然支持（就是 nodes+edges）
// - 注释行 %%、subgraph/end 行忽略
// 容错：不认识的字符跳过继续解析（尽力提取）；解析不出任何节点返回 null。
// 不支持（静默忽略）：subgraph 分组、class/style 样式、-- 文本 -- 形式边、& 多目标。
import { getLayoutedElements, type LayoutNode, type LayoutEdge } from '@ai-task-flow/shared';

/** 导入草稿节点（LayoutNode + 业务 data） */
export interface CanvasDraftNode extends LayoutNode {
  type?: string;
  data: { label: string };
}

/** 导入草稿边 */
export interface CanvasDraftEdge extends LayoutEdge {
  id: string;
  type: string;
  sourceHandle: string;
  targetHandle: string;
  data?: { label?: string };
}

/** 解析结果（mermaid 语义，不含坐标） */
export interface ParsedMermaid {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

/** 边符号（长符号在前优先匹配），可选 |标签| */
const EDGE_RE = /^(?:-.->|-->|==>|---)(?:\|([^|]*)\|)?\s*/;
/** 节点：id（字母数字下划线/中文）+ 可选三种形状文本 */
const NODE_RE = /^([A-Za-z0-9_\u4e00-\u9fff]+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*/;
/** 头行（flowchart LR / graph TD 等） */
const HEADER_RE = /^(?:flowchart|graph)\b/i;
/** 忽略的行：注释 / subgraph / end / class / style / click */
const SKIP_RE = /^(%%|subgraph\b|end\b|class\b|classDef\b|style\b|click\b|linkStyle\b)/i;

type Token =
  | { type: 'node'; id: string; label: string; hasShape: boolean }
  | { type: 'edge'; label?: string };

/** 解析单行 → token 序列（node/edge 交替，链式支持） */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line.trim();
  while (rest.length > 0) {
    const em = rest.match(EDGE_RE);
    if (em) {
      tokens.push({ type: 'edge', label: em[1]?.trim() || undefined });
      rest = rest.slice(em[0].length);
      continue;
    }
    const nm = rest.match(NODE_RE);
    if (nm && nm[1]) {
      // 三种形状取文本；无形状用 id 当 label（hasShape 区分定义 vs 引用）
      const shapeText = (nm[2] ?? nm[3] ?? nm[4])?.trim();
      tokens.push({ type: 'node', id: nm[1], label: shapeText || nm[1], hasShape: Boolean(shapeText) });
      rest = rest.slice(nm[0].length);
      continue;
    }
    // 容错：跳过无法识别的字符继续
    rest = rest.slice(1);
  }
  return tokens;
}

/**
 * 解析 mermaid flowchart 文本。
 * 要求存在 flowchart/graph 头行（防普通文本误导入）；任何节点都解析不出返回 null。
 * 导出供测试。
 */
export function parseMermaidFlowchart(text: string): ParsedMermaid | null {
  const nodeLabels = new Map<string, string>();
  const edges: ParsedMermaid['edges'] = [];
  let sawHeader = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || SKIP_RE.test(line)) continue;
    if (HEADER_RE.test(line)) {
      sawHeader = true; // 头行：方向忽略（导入后走画布布局）
      continue;
    }

    const tokens = tokenizeLine(line);
    let lastNode: string | null = null;
    let pendingEdgeLabel: string | undefined;
    for (const tk of tokens) {
      if (tk.type === 'node') {
        // mermaid 语义：带形状文本 = 定义（后见覆盖）；裸 id = 引用（仅首次登记，
        // 不覆盖已有标签——否则 B --> C 会把 B[处理] 冲掉）
        if (tk.hasShape || !nodeLabels.has(tk.id)) {
          nodeLabels.set(tk.id, tk.label);
        }
        if (lastNode !== null) {
          edges.push({ from: lastNode, to: tk.id, label: pendingEdgeLabel });
          pendingEdgeLabel = undefined;
        }
        lastNode = tk.id;
      } else {
        pendingEdgeLabel = tk.label ?? pendingEdgeLabel;
        // 连续边符号（语法错误）时保留最后一个非空标签，lastNode 不变
      }
    }
  }

  if (!sawHeader || nodeLabels.size === 0) return null;
  return {
    nodes: [...nodeLabels.entries()].map(([id, label]) => ({ id, label })),
    edges,
  };
}

/**
 * 解析结果 → 画布节点/边草稿（新 id，避免与现有节点冲突），
 * 用 shared DFS 布局排好并整体平移到目标锚点（调用方传视口中心）。
 * 导出供测试。
 */
export function toCanvasDraft(
  parsed: ParsedMermaid,
  anchor: { x: number; y: number },
): { nodes: CanvasDraftNode[]; edges: CanvasDraftEdge[] } {
  // mermaid id → 新 uuid 映射（避免与文档现有节点 id 撞）
  const idMap = new Map<string, string>();
  for (const n of parsed.nodes) idMap.set(n.id, crypto.randomUUID());

  const rawNodes: CanvasDraftNode[] = parsed.nodes.map((n) => ({
    id: idMap.get(n.id)!,
    type: 'mindmap',
    position: { x: 0, y: 0 },
    measured: { width: 160, height: 40 }, // 布局用的保守尺寸（渲染后 RF 重测）
    data: { label: n.label },
  }));
  const rawEdges = parsed.edges.map((e) => ({
    id: crypto.randomUUID(),
    source: idMap.get(e.from)!,
    target: idMap.get(e.to)!,
    type: 'mindmap',
    sourceHandle: 'right',
    targetHandle: 'left',
    data: e.label ? { label: e.label } : undefined,
  }));

  const { nodes: layouted } = getLayoutedElements(rawNodes, rawEdges);

  // 整体平移到锚点（取布局后包围盒左上角对齐锚点）
  const xs = layouted.map((n) => n.position.x);
  const ys = layouted.map((n) => n.position.y);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const shifted = layouted.map((n) => ({
    ...n,
    position: { x: n.position.x - minX + anchor.x, y: n.position.y - minY + anchor.y },
  }));

  return { nodes: shifted, edges: rawEdges };
}
