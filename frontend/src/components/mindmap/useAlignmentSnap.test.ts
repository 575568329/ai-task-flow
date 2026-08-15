// frontend/src/components/mindmap/useAlignmentSnap.test.ts
// 对齐吸附纯函数单测
import { describe, it, expect } from 'vitest';
import { computeSnapLines, type SnapNode } from './useAlignmentSnap';

function snap(id: string, x: number, y: number, w = 100, h = 40): SnapNode {
  return { id, position: { x, y }, width: w, height: h };
}

describe('computeSnapLines', () => {
  it('should snap left edges when within threshold', () => {
    // 拖动节点左边 102，目标节点左边 100，阈值 8 → dx = -2
    const dragging = [snap('d1', 102, 200)];
    const others = [snap('o1', 100, 0)];
    const { dx, lines } = computeSnapLines(dragging, others, 8);
    expect(dx).toBe(-2);
    expect(lines.some((l) => l.type === 'vertical' && Math.abs(l.position - 100) < 0.01)).toBe(true);
  });

  it('should snap center X when within threshold', () => {
    const dragging2 = [snap('d1', 52, 200)]; // 右 152
    const others2 = [snap('o1', 52, 0)]; // 右 152 → dx=0
    const r = computeSnapLines(dragging2, others2, 8);
    expect(r.dx).toBe(0);
    expect(r.lines).toHaveLength(3); // 左/中心/右全部对齐
  });

  it('should not snap when beyond threshold', () => {
    const dragging = [snap('d1', 200, 200)];
    const others = [snap('o1', 0, 0)];
    const { dx, dy, lines } = computeSnapLines(dragging, others, 8);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(lines).toHaveLength(0);
  });

  it('should snap vertical center Y', () => {
    // 拖动节点 y=301 中心 y=321；目标 y=0 中心 y=20；y 偏差最小：上边 301 vs 0? 301。
    // 目标底部 40 vs 拖动上 301 → 261。都超。让目标在 y=300：
    const dragging = [snap('d1', 500, 303)]; // 中心 323
    const others = [snap('o1', 0, 300)]; // 中心 320
    const { dy, lines } = computeSnapLines(dragging, others, 8);
    // 中心偏差 320-323 = -3 ≤ 8
    expect(dy).toBe(-3);
    expect(lines.some((l) => l.type === 'horizontal')).toBe(true);
  });

  it('should choose the smallest delta among candidates', () => {
    // 两个目标：一个偏差 5，一个偏差 2 → 取 2
    const dragging = [snap('d1', 102, 500)];
    const others = [snap('o1', 107, 0), snap('o2', 104, 1000)];
    const { dx } = computeSnapLines(dragging, others, 8);
    expect(dx).toBe(2); // 104 - 102
  });

  it('should compute union box for multi-node drag', () => {
    // 两个拖动节点联合盒 right=400；目标 right=408 → dx=8（恰好阈值内）
    const dragging = [snap('a', 0, 0), snap('b', 300, 300)];
    const others = [snap('o1', 308, 600)];
    const { dx } = computeSnapLines(dragging, others, 8);
    expect(dx).toBe(8);
  });

  it('should return empty for empty inputs', () => {
    expect(computeSnapLines([], [snap('o', 0, 0)], 8)).toEqual({ dx: 0, dy: 0, lines: [] });
    expect(computeSnapLines([snap('d', 0, 0)], [], 8)).toEqual({ dx: 0, dy: 0, lines: [] });
    expect(computeSnapLines([snap('d', 0, 0)], [snap('o', 0, 0)], 0)).toEqual({ dx: 0, dy: 0, lines: [] });
  });
});
