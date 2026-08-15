// frontend/src/components/mindmap/floatingEdgeUtils.ts
// 浮动边几何算法（照搬 React Flow 官方 FloatingEdges 示例思路，核心改为可测试的纯函数）。
//
// 原理：边不再从固定 handle（Left/Right）出发，而是取 source/target 节点中心连线
// 与各自包围盒的交点作为端点，方向（Top/Right/Bottom/Left）由交点落在哪条边决定。
// 节点怎么摆、怎么缩放，连线永远从最近的边出发且自动跟随。
//
// measured 空值保护：新建节点首帧 measured 未被 ResizeObserver 填充时返回 null，
// 调用方（BranchEdge）跳过渲染一帧，避免 NaN 路径。
import { Position, type InternalNode, type XYPosition } from '@xyflow/react';

/** 浮边计算所需的最小节点形状（纯函数核心用，便于测试不依赖 RF InternalNode） */
export interface FloatingNodeBox {
  /** 节点左上角绝对坐标（RF internals.positionAbsolute） */
  positionAbsolute: { x: number; y: number };
  /** 实测尺寸（RF measured）；缺失视为未就绪 */
  measured?: { width?: number; height?: number };
}

/** 浮边端点参数（供 getBezierPath 消费） */
export interface FloatingEdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

function centerOf(node: FloatingNodeBox): XYPosition {
  const w = (node.measured?.width ?? 0) / 2;
  const h = (node.measured?.height ?? 0) / 2;
  return { x: node.positionAbsolute.x + w, y: node.positionAbsolute.y + h };
}

/**
 * 计算节点中心 → 另一节点中心的射线与本节点包围盒边框的交点。
 * 未就绪（measured 缺失或宽高为 0）返回 null。
 */
export function getNodeIntersection(node: FloatingNodeBox, other: FloatingNodeBox): XYPosition | null {
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  if (w <= 0 || h <= 0) return null;

  const c = centerOf(node);
  const o = centerOf(other);
  const dx = o.x - c.x;
  const dy = o.y - c.y;
  if (dx === 0 && dy === 0) return c; // 两节点完全重叠，退化为中心点

  // 射线参数化 c + t*(dx,dy)，与矩形边框相交的最小 t ∈ [0,1]
  const tx = dx !== 0 ? w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** 由交点落在包围盒哪条边判定方向（用于贝塞尔曲线的出边朝向） */
export function getEdgePosition(node: FloatingNodeBox, intersection: XYPosition): Position {
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  const x = intersection.x - node.positionAbsolute.x; // 节点局部坐标
  const y = intersection.y - node.positionAbsolute.y;
  const dl = x; // 距左边
  const dr = w - x; // 距右边
  const dt = y; // 距上边
  const db = h - y; // 距下边
  const min = Math.min(dl, dr, dt, db);
  if (min === dl) return Position.Left;
  if (min === dr) return Position.Right;
  if (min === dt) return Position.Top;
  return Position.Bottom;
}

/**
 * 计算浮边端点参数（source/target 各取交点 + 方向）。
 * 任一节点未就绪（measured 缺失）返回 null，调用方跳过渲染。
 */
export function getFloatingEdgeParams(
  source: FloatingNodeBox,
  target: FloatingNodeBox,
): FloatingEdgeParams | null {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);
  if (!sourceIntersection || !targetIntersection) return null;
  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}

/** 从 RF InternalNode 提取浮边计算所需的最小形状 */
export function toFloatingBox(node: InternalNode): FloatingNodeBox {
  return { positionAbsolute: node.internals.positionAbsolute, measured: node.measured };
}
