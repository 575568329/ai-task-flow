// frontend/src/components/mindmap/OutlinePanel.tsx
// 只读大纲侧栏：从 RF store 拉 nodes/edges 构建树，点击节点定位画布（setCenter）。
// 视觉：精致卡片 + 毛玻璃 + 树形竖线引导 + 字重层级 + hover/active 高亮。
import { memo, useMemo, useState } from 'react';
import { Panel, useReactFlow, useStore, type Node, type Edge } from '@xyflow/react';
import { ChevronRight, ChevronDown, Network } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const tree = useMemo(() => buildOutlineTree(nodes as Node[], edges as Edge[]), [nodes, edges]);

  const handleLocate = (id: string) => {
    setActiveId(id);
    const node = getNode(id);
    if (!node) return;
    const w = (node.measured?.width ?? node.width ?? 100) as number;
    const h = (node.measured?.height ?? node.height ?? 40) as number;
    setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 400 });
  };

  if (!tree) return null;

  return (
    <Panel position="top-left" className="!m-2">
      <div className="bg-popover/95 w-60 overflow-hidden rounded-lg border shadow-lg backdrop-blur-sm">
        <div className="text-muted-foreground flex items-center gap-1.5 border-b px-2.5 py-2 text-xs font-semibold">
          <Network className="size-3.5" />
          大纲
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1">
          <OutlineRow node={tree} depth={0} activeId={activeId} onLocate={handleLocate} />
        </div>
      </div>
    </Panel>
  );
});

function OutlineRow({
  node,
  depth,
  activeId,
  onLocate,
}: {
  node: OutlineTreeNode;
  depth: number;
  activeId: string | null;
  onLocate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = activeId === node.id;

  return (
    // 非根：左缩进 + 竖线引导（border-l），递归形成树形视觉
    <div className={depth > 0 ? 'border-l border-border/50 ml-2 pl-1.5' : ''}>
      <div
        className={cn(
          'group/row flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors',
          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
        onClick={() => onLocate(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-muted-foreground/50 hover:text-foreground shrink-0 transition-colors"
            aria-label={expanded ? '折叠' : '展开'}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="text-muted-foreground/30 w-3 shrink-0 text-center text-[8px]">●</span>
        )}
        <span
          className={cn(
            'truncate',
            depth === 0 && 'font-semibold',
            depth === 1 && 'font-medium',
            depth >= 2 && 'text-muted-foreground',
          )}
        >
          {node.label || '(空)'}
        </span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((c) => (
          <OutlineRow key={c.id} node={c} depth={depth + 1} activeId={activeId} onLocate={onLocate} />
        ))}
    </div>
  );
}
