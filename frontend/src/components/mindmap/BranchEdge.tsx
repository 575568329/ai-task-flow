// frontend/src/components/mindmap/BranchEdge.tsx
// 自定义连线：浮边（floating edge）+ 分支色 + 无箭头。
//
// 浮边：忽略固定 handle 方向，从 nodeLookup 读 source/target 节点，
// 用中心连线与包围盒的交点作为端点（见 floatingEdgeUtils），
// 节点任意摆放/缩放时连线自动跟随且从最近的边出发。
// measured 未就绪（新节点首帧）时跳过渲染一帧，避免 NaN 路径。
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type EdgeProps, type Edge } from '@xyflow/react';
import { getFloatingEdgeParams, toFloatingBox } from './floatingEdgeUtils';

export type MindmapRFEdge = Edge<{ branch?: string; label?: string }, 'mindmap'>;

export const BranchEdge = memo(function BranchEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<MindmapRFEdge>) {
  // 精确订阅两端节点（引用不变则本边不重渲染；拖动时只有相关边重算）
  const sourceNode = useStore((s) => s.nodeLookup.get(source));
  const targetNode = useStore((s) => s.nodeLookup.get(target));

  if (!sourceNode || !targetNode) return null;
  const params = getFloatingEdgeParams(toFloatingBox(sourceNode), toFloatingBox(targetNode));
  if (!params) return null; // measured 未就绪，跳过本帧

  const [path, labelX, labelY] = getBezierPath({
    sourceX: params.sx,
    sourceY: params.sy,
    sourcePosition: params.sourcePos,
    targetX: params.tx,
    targetY: params.ty,
    targetPosition: params.targetPos,
    curvature: 0.5,
  });

  const branch = data?.branch;
  const color = branch ? `var(--branch-${branch}-line)` : 'var(--muted-foreground)';
  const label = data?.label?.trim();

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.75,
          strokeOpacity: selected ? 1 : 0.6,
          fill: 'none',
          transition: 'stroke-opacity 0.15s ease, stroke-width 0.15s ease',
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
