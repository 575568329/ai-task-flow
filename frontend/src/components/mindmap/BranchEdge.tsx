// frontend/src/components/mindmap/BranchEdge.tsx
// 自定义连线：贝塞尔曲线 + 分支色 + 无箭头 + 线宽随选中态。
// React.memo 包裹；分支色从 data.branch 取 CSS 变量，深浅色自动跟随。
import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';

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
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  const branch = data?.branch;
  const color = branch ? `var(--branch-${branch}-line)` : undefined;

  return (
    <BaseEdge
      id={id}
      path={path}
      // BaseEdge 默认 interactionWidth=20 提供透明命中区，无需手写
      style={{
        stroke: color,
        strokeWidth: selected ? 3 : 2,
        strokeOpacity: 0.75,
        fill: 'none',
      }}
    />
  );
});
