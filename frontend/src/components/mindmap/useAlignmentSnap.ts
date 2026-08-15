// frontend/src/components/mindmap/useAlignmentSnap.ts
// 对齐辅助线（自研，RF 无内置）：拖动节点时与其它节点的边缘/中心对齐吸附。
//
// 算法（Excalidraw/tldraw 同款思路）：
// - 拖动节点集合取联合包围盒，参考线 = 左/水平中心/右 × 上/垂直中心/下 共 6 条
// - 与其余节点的对应参考线比对，阈值内（8px/zoom，屏幕像素恒定）取最小偏差吸附
// - 吸附量以 dx/dy 修正 change.position（官方 helper-lines 拦截模式）
//
// 性能：helperLines 用本地 useState（不进 Zustand），拖动时只有画布容器重渲染一次。
import { useCallback, useState } from 'react';
import type { NodeChange, XYPosition } from '@xyflow/react';

/** 一条辅助线：vertical = x 坐标处的竖线；horizontal = y 坐标处的横线（画布坐标系） */
export interface HelperLine {
  id: string;
  type: 'vertical' | 'horizontal';
  position: number;
}

/** 对齐计算所需的最小节点形状 */
export interface SnapNode {
  id: string;
  position: XYPosition;
  width: number;
  height: number;
}

/** 阈值内可命中的参考线集合 */
interface SnapResult {
  dx: number;
  dy: number;
  lines: HelperLine[];
}

const EPSILON = 0.5; // 吸附后判定参考线命中的容差（画布单位）

/**
 * 计算拖动集合相对其余节点的对齐吸附。
 * 纯函数，导出供测试。
 */
export function computeSnapLines(dragging: SnapNode[], others: SnapNode[], threshold: number): SnapResult {
  if (dragging.length === 0 || others.length === 0 || threshold <= 0) {
    return { dx: 0, dy: 0, lines: [] };
  }

  // 拖动集合的联合包围盒
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const d of dragging) {
    left = Math.min(left, d.position.x);
    right = Math.max(right, d.position.x + d.width);
    top = Math.min(top, d.position.y);
    bottom = Math.max(bottom, d.position.y + d.height);
  }
  const dragCenterX = (left + right) / 2;
  const dragCenterY = (top + bottom) / 2;

  const xRefsOf = (n: SnapNode) => [n.position.x, n.position.x + n.width / 2, n.position.x + n.width];
  const yRefsOf = (n: SnapNode) => [n.position.y, n.position.y + n.height / 2, n.position.y + n.height];

  // 求某轴上的最小偏差吸附量
  const bestDelta = (dragRefs: number[], otherRefs: number[]): number | null => {
    let best: number | null = null;
    for (const dr of dragRefs) {
      for (const or of otherRefs) {
        const delta = or - dr;
        if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
          best = delta;
        }
      }
    }
    return best;
  };

  const collectOtherRefs = (refsOf: (n: SnapNode) => number[]): number[] => {
    const out: number[] = [];
    for (const o of others) out.push(...refsOf(o));
    return out;
  };

  const dx = bestDelta([left, dragCenterX, right], collectOtherRefs(xRefsOf)) ?? 0;
  const dy = bestDelta([top, dragCenterY, bottom], collectOtherRefs(yRefsOf)) ?? 0;

  // 吸附后收集命中的参考线（两端都在阈值内才算对齐成功）
  const lines: HelperLine[] = [];
  const dragXRefs = [left + dx, dragCenterX + dx, right + dx];
  for (const ref of dragXRefs) {
    if (collectOtherRefs(xRefsOf).some((or) => Math.abs(or - ref) <= EPSILON)) {
      lines.push({ id: `v-${ref.toFixed(1)}`, type: 'vertical', position: ref });
    }
  }
  const dragYRefs = [top + dy, dragCenterY + dy, bottom + dy];
  for (const ref of dragYRefs) {
    if (collectOtherRefs(yRefsOf).some((or) => Math.abs(or - ref) <= EPSILON)) {
      lines.push({ id: `h-${ref.toFixed(1)}`, type: 'horizontal', position: ref });
    }
  }

  return { dx, dy, lines };
}

/** 从节点列表构造 SnapNode（measured 优先，显式 width/height 兜底） */
export function toSnapNode(node: {
  id: string;
  position: XYPosition;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}): SnapNode {
  return {
    id: node.id,
    position: node.position,
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  };
}

/** RF 位置变更类型守卫（拖动中的 position change） */
function isDragPositionChange(c: NodeChange): c is NodeChange & { type: 'position'; id: string; position: XYPosition; dragging?: boolean } {
  return c.type === 'position' && 'position' in c && c.position != null;
}

/**
 * 对齐吸附 hook：拦截 onNodesChange 的拖动位置变更，注入吸附修正。
 * 返回 enhanceChanges（包进 onNodesChange）与 helperLines（渲染辅助线）。
 */
export function useAlignmentSnap(params: {
  getNodes: () => Array<{
    id: string;
    position: XYPosition;
    hidden?: boolean;
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
  }>;
  /** 吸附阈值（画布单位），调用方算好 8/zoom 传入 */
  getThreshold: () => number;
}): {
  enhanceChanges: (changes: NodeChange[]) => NodeChange[];
  helperLines: HelperLine[];
  clearLines: () => void;
} {
  const { getNodes, getThreshold } = params;
  const [helperLines, setHelperLines] = useState<HelperLine[]>([]);

  const clearLines = useCallback(() => setHelperLines([]), []);

  const enhanceChanges = useCallback(
    (changes: NodeChange[]): NodeChange[] => {
      const posChanges = changes.filter(isDragPositionChange);
      const hasDrag = posChanges.some((c) => c.dragging);
      if (!hasDrag) {
        // 非拖动（选中/尺寸等）变更不清理辅助线——由 onNodeDragStop 统一清理
        return changes;
      }

      const draggedIds = new Set(posChanges.map((c) => c.id));
      const others = getNodes()
        .filter((n) => !draggedIds.has(n.id) && !n.hidden)
        .map(toSnapNode);
      if (others.length === 0) {
        setHelperLines([]);
        return changes;
      }

      // 拖动节点用"提议位置"（change.position）而非当前 state 位置
      const byId = new Map(getNodes().map((n) => [n.id, n]));
      const dragging = posChanges.map((c) => {
        const n = byId.get(c.id);
        return {
          id: c.id,
          position: c.position,
          width: n?.measured?.width ?? n?.width ?? 0,
          height: n?.measured?.height ?? n?.height ?? 0,
        };
      });

      const { dx, dy, lines } = computeSnapLines(dragging, others, getThreshold());
      setHelperLines(lines);
      if (dx === 0 && dy === 0) return changes;

      const corrected = new Map(
        posChanges.map((c) => [c.id, { x: c.position.x + dx, y: c.position.y + dy }]),
      );
      return changes.map((c) => {
        const pos = c.type === 'position' ? corrected.get(c.id) : undefined;
        return pos ? { ...c, position: pos } : c;
      });
    },
    [getNodes, getThreshold],
  );

  return { enhanceChanges, helperLines, clearLines };
}
