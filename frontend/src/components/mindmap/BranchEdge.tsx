// frontend/src/components/mindmap/BranchEdge.tsx
// 自定义连线：贝塞尔曲线 + 分支色 + 无箭头。
// 关键：sourcePosition=Right / targetPosition=Left 必须匹配节点 handle（右出左入），
// 否则曲度方向错位、显得僵硬；curvature 0.5 比默认 0.25 更柔和自然。
import { memo } from 'react';
import { BaseEdge, getBezierPath, Position, type EdgeProps, type Edge } from '@xyflow/react';

export type MindmapRFEdge = Edge<{ branch?: string }, 'mindmap'>;

export const BranchEdge = memo(function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<MindmapRFEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.5,
  });
  const branch = data?.branch;
  const color = branch ? `var(--branch-${branch}-line)` : 'var(--muted-foreground)';

  return (
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
  );
});
