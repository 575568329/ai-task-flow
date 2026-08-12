// frontend/src/components/mindmap/useMindmapActions.test.ts
// 思维导图节点操作测试：computeHidden/applyHidden（纯函数）+ useMindmapActions（hook）。
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useMindmapActions,
  computeHidden,
  applyHidden,
  adjustSubtreeLevel,
} from './useMindmapActions';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';
import type { BranchKey } from '@ai-task-flow/shared';

function node(
  id: string,
  opts: { level?: number; expanded?: boolean; branch?: BranchKey } = {},
): MindmapRFNode {
  return {
    id,
    type: 'mindmap',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      level: opts.level ?? 1,
      expanded: opts.expanded ?? true,
      branch: opts.branch ?? 'blue',
    },
  };
}
function edge(id: string, source: string, target: string): MindmapRFEdge {
  return { id, source, target, type: 'mindmap', data: { branch: 'blue' } };
}

describe('computeHidden（折叠后代计算）', () => {
  it('全部展开：hidden 为空', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    expect(computeHidden(nodes, edges).size).toBe(0);
  });

  it('折叠根：所有后代 hidden，根本身可见', () => {
    const nodes = [node('a', { level: 0, expanded: false }), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const h = computeHidden(nodes, edges);
    expect(h.has('b')).toBe(true);
    expect(h.has('c')).toBe(true);
    expect(h.has('a')).toBe(false);
  });

  it('折叠中间节点：仅其后代 hidden，兄弟分支不受影响', () => {
    const nodes = [
      node('a', { level: 0 }),
      node('b', { expanded: false }),
      node('c'),
      node('d'),
    ];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'd')];
    const h = computeHidden(nodes, edges);
    expect(h.has('c')).toBe(true); // b 的后代
    expect(h.has('b')).toBe(false); // b 本身可见
    expect(h.has('d')).toBe(false); // a 的另一子，不受影响
  });
});

describe('applyHidden（写入 hidden 字段）', () => {
  it('hidden 集合中的节点 + 关联边标记 hidden', () => {
    const nodes = [node('a', { level: 0, expanded: false }), node('b')];
    const edges = [edge('e1', 'a', 'b')];
    const r = applyHidden(nodes, edges);
    expect(r.nodes.find((n) => n.id === 'b')?.hidden).toBe(true);
    expect(r.nodes.find((n) => n.id === 'a')?.hidden).toBeUndefined();
    expect(r.edges.find((e) => e.id === 'e1')?.hidden).toBe(true); // target b hidden
  });

  it('全展开：无 hidden 标记', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('e1', 'a', 'b')];
    const r = applyHidden(nodes, edges);
    expect(r.nodes.every((n) => n.hidden === undefined)).toBe(true);
    expect(r.edges.every((e) => e.hidden === undefined)).toBe(true);
  });
});

describe('useMindmapActions（hook）', () => {
  function setup(nodes: MindmapRFNode[], edges: MindmapRFEdge[]) {
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const latest = { nodes, edges };
    const { result } = renderHook(() =>
      useMindmapActions({
        setNodes,
        setEdges,
        getLatest: () => latest,
        markDirty: vi.fn(),
        triggerSave: vi.fn(),
      }),
    );
    return { result, setNodes, setEdges };
  }

  it('addChildNode：新增子节点+边，子节点 selected，原节点取消选中', () => {
    const parent = node('p', { level: 0 });
    const { result, setNodes, setEdges } = setup([parent], []);
    result.current.addChildNode('p');
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes).toHaveLength(2);
    const child = newNodes.find((n) => n.id !== 'p')!;
    expect(child.data.level).toBe(1);
    expect(child.selected).toBe(true);
    expect(child.data.branch).toBe('blue'); // 继承父分支
    expect(newNodes.find((n) => n.id === 'p')?.selected).toBeFalsy();
    const newEdges = setEdges.mock.calls[0][0] as MindmapRFEdge[];
    expect(newEdges).toHaveLength(1);
    expect(newEdges[0].source).toBe('p');
    expect(newEdges[0].target).toBe(child.id);
  });

  it('deleteNode：根节点不可删（不触发 setNodes）', () => {
    const root = node('root', { level: 0 });
    const { result, setNodes } = setup([root], []);
    result.current.deleteNode('root');
    expect(setNodes).not.toHaveBeenCalled();
  });

  it('deleteNode：删除节点 + 递归后代 + 关联边', () => {
    const root = node('root', { level: 0 });
    const child = node('c1');
    const grand = node('g1');
    const { result, setNodes, setEdges } = setup(
      [root, child, grand],
      [edge('e1', 'root', 'c1'), edge('e2', 'c1', 'g1')],
    );
    result.current.deleteNode('c1');
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes.map((n) => n.id)).toEqual(['root']); // c1 + g1 都删
    const newEdges = setEdges.mock.calls[0][0] as MindmapRFEdge[];
    expect(newEdges).toHaveLength(0);
  });

  it('toggleExpand：翻转 expanded，后代重算 hidden', () => {
    const root = node('root', { level: 0, expanded: true });
    const child = node('c1');
    const { result, setNodes } = setup([root, child], [edge('e1', 'root', 'c1')]);
    result.current.toggleExpand('root');
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes.find((n) => n.id === 'root')?.data.expanded).toBe(false);
    expect(newNodes.find((n) => n.id === 'c1')?.hidden).toBe(true);
  });

  it('addSiblingNode：根节点无同级（不触发）', () => {
    const root = node('root', { level: 0 });
    const { result, setNodes } = setup([root], []);
    result.current.addSiblingNode('root');
    expect(setNodes).not.toHaveBeenCalled();
  });

  it('addSiblingNode：非根新增同级 + 连接到同一父', () => {
    const root = node('root', { level: 0 });
    const child = node('c1');
    const { result, setNodes, setEdges } = setup([root, child], [edge('e1', 'root', 'c1')]);
    result.current.addSiblingNode('c1');
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes).toHaveLength(3);
    const sibling = newNodes.find((n) => n.id !== 'root' && n.id !== 'c1')!;
    expect(sibling.selected).toBe(true);
    const newEdges = setEdges.mock.calls[0][0] as MindmapRFEdge[];
    expect(newEdges).toHaveLength(2);
    expect(newEdges.some((e) => e.target === sibling.id && e.source === 'root')).toBe(true);
  });

  it('promoteNode：root 不可提升', () => {
    const root = node('root', { level: 0 });
    const { result, setNodes } = setup([root], []);
    result.current.promoteNode('root');
    expect(setNodes).not.toHaveBeenCalled();
  });

  it('promoteNode：level2 提升成 grandparent 子，edge source 改、level-1', () => {
    const root = node('root', { level: 0 });
    const a = node('a', { level: 1 });
    const b = node('b', { level: 2 });
    const { result, setNodes, setEdges } = setup(
      [root, a, b],
      [edge('e1', 'root', 'a'), edge('e2', 'a', 'b')],
    );
    result.current.promoteNode('b');
    const newEdges = setEdges.mock.calls[0][0] as MindmapRFEdge[];
    expect(newEdges.find((e) => e.id === 'e2')!.source).toBe('root'); // b 父从 a → root
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes.find((n) => n.id === 'b')!.data.level).toBe(1);
  });

  it('demoteNode：第一个子不可降级', () => {
    const root = node('root', { level: 0 });
    const a = node('a', { level: 1 });
    const { result, setNodes } = setup([root, a], [edge('e1', 'root', 'a')]);
    result.current.demoteNode('a');
    expect(setNodes).not.toHaveBeenCalled();
  });

  it('demoteNode：非首降级成前兄弟子，edge source 改、level+1', () => {
    const root = node('root', { level: 0 });
    const a = node('a', { level: 1 });
    const b = node('b', { level: 1 });
    const { result, setNodes, setEdges } = setup(
      [root, a, b],
      [edge('e1', 'root', 'a'), edge('e2', 'root', 'b')],
    );
    result.current.demoteNode('b');
    const newEdges = setEdges.mock.calls[0][0] as MindmapRFEdge[];
    expect(newEdges.find((e) => e.id === 'e2')!.source).toBe('a'); // b 父从 root → a
    const newNodes = setNodes.mock.calls[0][0] as MindmapRFNode[];
    expect(newNodes.find((n) => n.id === 'b')!.data.level).toBe(2);
  });
});

describe('adjustSubtreeLevel', () => {
  it('递归调整 rootId 及后代 level，非子树不动', () => {
    const nodes = [node('root', { level: 0 }), node('a', { level: 1 }), node('b', { level: 2 })];
    const edges = [edge('e1', 'root', 'a'), edge('e2', 'a', 'b')];
    const r = adjustSubtreeLevel(nodes, edges, 'a', 1);
    expect(r.find((n) => n.id === 'a')!.data.level).toBe(2);
    expect(r.find((n) => n.id === 'b')!.data.level).toBe(3);
    expect(r.find((n) => n.id === 'root')!.data.level).toBe(0);
  });

  it('level 不低于 0', () => {
    const nodes = [node('root', { level: 0 }), node('a', { level: 1 })];
    const edges = [edge('e1', 'root', 'a')];
    const r = adjustSubtreeLevel(nodes, edges, 'a', -5);
    expect(r.find((n) => n.id === 'a')!.data.level).toBe(0);
  });
});
