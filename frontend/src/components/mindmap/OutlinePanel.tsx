// frontend/src/components/mindmap/OutlinePanel.tsx
// 只读大纲侧栏：从 RF store 拉 nodes/edges 构建树，点击节点定位画布（setCenter）。
// 独立组件（不依赖 MindmapEditor 本地 state），放在 ReactFlow 内的 Panel。
import { memo, useMemo, useState } from 'react';
import { Panel, useReactFlow, useStore, type Node, type Edge } from '@xyflow/react';
import { ChevronRight, ChevronDown, Network } from 'lucide-react';

/** 树节点 */
export interface OutlineTreeNode {
  id: string;
  label: string;
  level: number;
  children: OutlineTreeNode[];
}

/**
 * 从扁平 nodes/edges 构建嵌套树。
 * root = 无入边的节点（level 0）；按 edges 的 source→target 父子关系递归。
 * 导出供测试。
 */
export function buildOutlineTree(nodes: Node[], edges: Edge[]): OutlineTreeNode | null {
  if (nodes.length === 0) return null;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  }
  const hasParent = new Set(edges.map((e) => e.target));
  const rootId = nodes.find((n) => !hasParent.has(n.id))?.id;
  if (!rootId) return null;

  const build = (id: string): OutlineTreeNode => {
    const n = nodeMap.get(id)!;
    const data = (n.data ?? {}) as { label?: string; level?: number };
    return {
      id,
      label: data.label ?? id,
      level: data.level ?? 0,
      children: (childrenOf.get(id) ?? []).map(build),
    };
  };
  return build(rootId);
}

export const OutlinePanel = memo(function OutlinePanel() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const { setCenter, getNode } = useReactFlow();
  const tree = useMemo(() => buildOutlineTree(nodes as Node[], edges as Edge[]), [nodes, edges]);

  const handleLocate = (id: string) => {
    const node = getNode(id);
    if (!node) return;
    const w = (node.measured?.width ?? node.width ?? 100) as number;
    const h = (node.measured?.height ?? node.height ?? 40) as number;
    setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 400 });
  };

  if (!tree) return null;

  return (
    <Panel
      position="top-left"
      className="bg-card/95 w-56 max-h-[60vh] overflow-auto rounded-md border p-2 text-sm shadow-md backdrop-blur"
    >
      <div className="text-muted-foreground mb-1 flex items-center gap-1 px-1 text-xs font-medium">
        <Network className="size-3" /> 大纲
      </div>
      <OutlineRow node={tree} depth={0} onLocate={handleLocate} />
    </Panel>
  );
});

function OutlineRow({
  node,
  depth,
  onLocate,
}: {
  node: OutlineTreeNode;
  depth: number;
  onLocate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="hover:bg-accent flex cursor-pointer items-center gap-1 rounded px-1 py-0.5"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => onLocate(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0"
            aria-label={expanded ? '折叠' : '展开'}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="truncate">{node.label || '(空)'}</span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((c) => (
          <OutlineRow key={c.id} node={c} depth={depth + 1} onLocate={onLocate} />
        ))}
    </div>
  );
}
