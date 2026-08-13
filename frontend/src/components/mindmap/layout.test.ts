// frontend/src/components/mindmap/layout.test.ts
// dagre 自动布局测试：节点数量保持、坐标重排、泛型兼容、孤立节点。
import { describe, it, expect } from 'vitest';
import { getLayoutedElements } from './layout';

// 用最小形状测试（layout 是泛型，接收任意满足 LayoutNode 的对象）
const n = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  position: { x: 0, y: 0 },
  ...extra,
});
const e = (source: string, target: string) => ({ source, target });

describe('getLayoutedElements', () => {
  it('返回相同数量的 nodes/edges', () => {
    const r = getLayoutedElements(
      [n('a'), n('b')] as never,
      [e('a', 'b')] as never,
    );
    expect(r.nodes).toHaveLength(2);
    expect(r.edges).toHaveLength(1);
  });

  it('重排后至少一个节点 x 非零（水平树 LR）', () => {
    const r = getLayoutedElements(
      [n('a'), n('b')] as never,
      [e('a', 'b')] as never,
    );
    expect(r.nodes.some((x) => x.position.x !== 0)).toBe(true);
  });

  it('保留节点额外字段（泛型透传）', () => {
    const r = getLayoutedElements(
      [n('a', { data: { label: 'hi' }, custom: 'x' })] as never,
      [] as never,
    );
    expect((r.nodes[0] as { custom?: string }).custom).toBe('x');
  });

  it('孤立节点（无边）也能布局', () => {
    const r = getLayoutedElements([n('solo')] as never, [] as never);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].position).toBeDefined();
  });

  it('多层级树：节点数保持，坐标重排', () => {
    const r = getLayoutedElements(
      [n('root'), n('a'), n('b'), n('c')] as never,
      [e('root', 'a'), e('root', 'b'), e('a', 'c')] as never,
    );
    expect(r.nodes).toHaveLength(4);
    // 重排后坐标不全为 0
    expect(r.nodes.filter((x) => x.position.x !== 0 || x.position.y !== 0).length).toBeGreaterThan(0);
  });
});
