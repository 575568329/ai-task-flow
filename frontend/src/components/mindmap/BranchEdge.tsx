// frontend/src/components/mindmap/BranchEdge.tsx
// 自定义连线：贝塞尔曲线 + 分支色 + 无箭头 + 连线标签。
//
// 端点锚定 handle（Obsidian 式）：直接用 RF 传入的 source/target 坐标与朝向
// （由 sourceHandle/targetHandle + 节点位置计算），线连在连接点上、随节点移动跟随。
// 四向 handle（top/right/bottom/left）+ Loose 模式下，从哪个点拖出就连哪个点，
// 落点吸附目标节点最近的 handle。
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';

export type MindmapRFEdge = Edge<{ branch?: string; label?: string }, 'mindmap'>;

export const BranchEdge = memo(function BranchEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
}: EdgeProps<MindmapRFEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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
