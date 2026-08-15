// frontend/src/components/mindmap/FloatingConnectionLine.tsx
// 拖拽连线时的临时连线（自写组件，RF 无内置）。
// 走与 BranchEdge 相同的浮边算法：从起点节点的包围盒边缘出发指向鼠标位置，
// 让"正在连接"的预览线与松手后的正式边视觉一致。
import { getBezierPath, useStore, type ConnectionLineComponentProps, type InternalNode } from '@xyflow/react';
import { getFloatingEdgeParams } from './floatingEdgeUtils';

/** 鼠标位置包装成 1x1 的最小盒子（仅为复用交点算法，实际画到鼠标点） */
function cursorAsBox(x: number, y: number) {
  return { positionAbsolute: { x, y }, measured: { width: 1, height: 1 } };
}

export function FloatingConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  // connection 态：拖拽进行中时 fromNode = 连接起始节点（本版本 store 无 connectionStartHandle）
  const sourceNode = useStore((s) => (s.connection.inProgress ? s.connection.fromNode : undefined));

  if (sourceNode) {
    const src = sourceNode as InternalNode;
    const params = getFloatingEdgeParams(
      { positionAbsolute: src.internals.positionAbsolute, measured: src.measured },
      cursorAsBox(toX, toY),
    );
    if (params) {
      const [path] = getBezierPath({
        sourceX: params.sx,
        sourceY: params.sy,
        sourcePosition: params.sourcePos,
        targetX: toX,
        targetY: toY,
        targetPosition: params.targetPos,
        curvature: 0.5,
      });
      return (
        <g>
          <path
            d={path}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1.75}
            strokeOpacity={0.7}
            strokeDasharray="6 3"
          />
        </g>
      );
    }
  }

  // 兜底：拿不到起始节点（如 handle 尚未注册）时画直线
  return (
    <g>
      <line
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke="var(--muted-foreground)"
        strokeWidth={1.75}
        strokeOpacity={0.7}
        strokeDasharray="6 3"
      />
    </g>
  );
}
