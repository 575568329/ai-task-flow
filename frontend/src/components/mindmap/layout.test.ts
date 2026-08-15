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

  it('含环图不死递归（R5）：环尾按叶子布局，不出负坐标', () => {
    // root→b→c→b（c 指回 b 成环）：自由画布允许的形态
    const r = getLayoutedElements(
      [n('root'), n('b'), n('c')] as never,
      [e('root', 'b'), e('b', 'c'), e('c', 'b')] as never,
    );
    expect(r.nodes).toHaveLength(3);
    // 全部节点获得合法坐标（y 非负），环不再引发死递归/栈溢出
    for (const node of r.nodes) {
      expect(node.position.y).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(node.position.x)).toBe(true);
    }
    // c 在第二层（x > 0），说明环尾被当作叶子正常布局
    const c = r.nodes.find((x) => x.id === 'c')!;
    expect(c.position.x).toBeGreaterThan(0);
  });

  it('纯环（无根）不崩溃，节点全保留旧坐标', () => {
    const r = getLayoutedElements(
      [n('a', { position: { x: 5, y: 5 } }), n('b', { position: { x: 9, y: 9 } })] as never,
      [e('a', 'b'), e('b', 'a')] as never,
    );
    expect(r.nodes).toHaveLength(2);
    // 无根 → dfs 不启动 → 坐标原样保留
    expect(r.nodes.find((x) => x.id === 'a')!.position).toEqual({ x: 5, y: 5 });
    expect(r.nodes.find((x) => x.id === 'b')!.position).toEqual({ x: 9, y: 9 });
  });
});
