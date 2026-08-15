// frontend/src/components/mindmap/floatingEdgeUtils.test.ts
// 浮边几何算法单元测试（纯函数，不依赖 RF 运行时）
import { Position } from '@xyflow/react';
import { describe, it, expect } from 'vitest';
import {
  getNodeIntersection,
  getEdgePosition,
  getFloatingEdgeParams,
  type FloatingNodeBox,
} from './floatingEdgeUtils';

function box(x: number, y: number, w: number, h: number): FloatingNodeBox {
  return { positionAbsolute: { x, y }, measured: { width: w, height: h } };
}

describe('getNodeIntersection', () => {
  it('should return right edge midpoint when other is directly to the right', () => {
    // A(0,0,100,50) 中心(50,25)；B 在正右方
    const a = box(0, 0, 100, 50);
    const b = box(200, 0, 100, 50);
    const p = getNodeIntersection(a, b)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeCloseTo(100); // 右边缘
    expect(p.y).toBeCloseTo(25); // 垂直中点
  });

  it('should return left edge midpoint when other is directly to the left', () => {
    const a = box(200, 0, 100, 50);
    const b = box(0, 0, 100, 50);
    const p = getNodeIntersection(a, b)!;
    expect(p.x).toBeCloseTo(200); // 左边缘
    expect(p.y).toBeCloseTo(25);
  });

  it('should return bottom edge midpoint when other is directly below', () => {
    const a = box(0, 0, 100, 50);
    const b = box(0, 200, 100, 50);
    const p = getNodeIntersection(a, b)!;
    expect(p.x).toBeCloseTo(50); // 水平中点
    expect(p.y).toBeCloseTo(50); // 下边缘
  });

  it('should return top edge midpoint when other is directly above', () => {
    const a = box(0, 200, 100, 50);
    const b = box(0, 0, 100, 50);
    const p = getNodeIntersection(a, b)!;
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(200); // 上边缘
  });

  it('should return corner intersection on diagonal direction', () => {
    // A(0,0,100,100) 中心(50,50)；B 在右下 45° 方向 → 交点为角 (100,100)
    const a = box(0, 0, 100, 100);
    const b = box(200, 200, 100, 100);
    const p = getNodeIntersection(a, b)!;
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100);
  });

  it('should return null when measured is missing (new node first frame)', () => {
    const a: FloatingNodeBox = { positionAbsolute: { x: 0, y: 0 } };
    const b = box(200, 0, 100, 50);
    // 仅校验"自身无 measured"的方向；对方无 measured 时退化为其左上角（仅影响射线方向）
    expect(getNodeIntersection(a, b)).toBeNull();
  });

  it('should return null when measured width/height is zero', () => {
    expect(getNodeIntersection(box(0, 0, 0, 50), box(200, 0, 100, 50))).toBeNull();
    expect(getNodeIntersection(box(0, 0, 100, 0), box(200, 0, 100, 50))).toBeNull();
  });

  it('should return center when two nodes fully overlap', () => {
    const a = box(0, 0, 100, 50);
    const b = box(0, 0, 100, 50);
    const p = getNodeIntersection(a, b)!;
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(25);
  });
});

describe('getEdgePosition', () => {
  it('should detect Left/Right/Top/Bottom from intersection point', () => {
    const a = box(0, 0, 100, 50);
    expect(getEdgePosition(a, { x: 0, y: 25 })).toBe(Position.Left);
    expect(getEdgePosition(a, { x: 100, y: 25 })).toBe(Position.Right);
    expect(getEdgePosition(a, { x: 50, y: 0 })).toBe(Position.Top);
    expect(getEdgePosition(a, { x: 50, y: 50 })).toBe(Position.Bottom);
  });
});

describe('getFloatingEdgeParams', () => {
  it('should compute params for horizontal pair', () => {
    const a = box(0, 0, 100, 50);
    const b = box(300, 0, 100, 50);
    const params = getFloatingEdgeParams(a, b)!;
    expect(params).not.toBeNull();
    expect(params.sx).toBeCloseTo(100);
    expect(params.tx).toBeCloseTo(300);
    expect(params.sy).toBeCloseTo(25);
    expect(params.ty).toBeCloseTo(25);
    expect(params.sourcePos).toBe(Position.Right);
    expect(params.targetPos).toBe(Position.Left);
  });

  it('should compute params for vertical pair', () => {
    const a = box(0, 0, 100, 50);
    const b = box(0, 300, 100, 50);
    const params = getFloatingEdgeParams(a, b)!;
    expect(params.sourcePos).toBe(Position.Bottom);
    expect(params.targetPos).toBe(Position.Top);
  });

  it('should return null when either node lacks measured', () => {
    const unmeasured: FloatingNodeBox = { positionAbsolute: { x: 0, y: 0 } };
    expect(getFloatingEdgeParams(unmeasured, box(200, 0, 100, 50))).toBeNull();
    expect(getFloatingEdgeParams(box(0, 0, 100, 50), unmeasured)).toBeNull();
  });

  it('should handle different sized nodes', () => {
    // A 小(100x50) B 大(200x100)，B 在右下方
    const a = box(0, 0, 100, 50);
    const b = box(300, 200, 200, 100);
    const params = getFloatingEdgeParams(a, b)!;
    // A 的交点必须在 A 的边框上
    expect(params.sx).toBeGreaterThanOrEqual(0);
    expect(params.sx).toBeLessThanOrEqual(100);
    expect(params.sy).toBeGreaterThanOrEqual(0);
    expect(params.sy).toBeLessThanOrEqual(50);
    // B 的交点必须在 B 的边框上
    expect(params.tx).toBeGreaterThanOrEqual(300);
    expect(params.tx).toBeLessThanOrEqual(500);
    expect(params.ty).toBeGreaterThanOrEqual(200);
    expect(params.ty).toBeLessThanOrEqual(300);
  });
});
