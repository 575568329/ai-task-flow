// frontend/src/components/mindmap/useCanvasActions.test.ts
// 自由画布操作纯函数单测：模式判定 + 删除语义（不依赖 RF 运行时）
import { describe, it, expect } from 'vitest';
import { isTreeDocument, removeNodesWithEdges } from './useCanvasActions';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';

function n(id: string): MindmapRFNode {
  return { id, type: 'mindmap', position: { x: 0, y: 0 }, data: { label: id } };
}
function e(id: string, source: string, target: string): MindmapRFEdge {
  return { id, source, target, type: 'mindmap' };
}

describe('isTreeDocument', () => {
  it('should return true for a single-root tree', () => {
    // a → b, a → c
    const nodes = [n('a'), n('b'), n('c')];
    const edges = [e('e1', 'a', 'b'), e('e2', 'a', 'c')];
    expect(isTreeDocument(nodes, edges)).toBe(true);
  });

  it('should return false for empty document', () => {
    expect(isTreeDocument([], [])).toBe(false);
  });

  it('should return false when a node has multiple parents (DAG)', () => {
    // a → c, b → c（c 入度 2）
    const nodes = [n('a'), n('b'), n('c')];
    const edges = [e('e1', 'a', 'c'), e('e2', 'b', 'c')];
    expect(isTreeDocument(nodes, edges)).toBe(false);
  });

  it('should return false for a pure cycle (no root)', () => {
    // a → b → a（环，无入度 0 节点）
    const nodes = [n('a'), n('b')];
    const edges = [e('e1', 'a', 'b'), e('e2', 'b', 'a')];
    expect(isTreeDocument(nodes, edges)).toBe(false);
  });

  it('should return true for disconnected nodes without edges (forest-ish)', () => {
    // 双击创建的孤立节点（无任何边）：每个节点都是"根"
    const nodes = [n('a'), n('b')];
    expect(isTreeDocument(nodes, [])).toBe(true);
  });
});

describe('removeNodesWithEdges', () => {
  it('should remove node and its connected edges only (not subtree)', () => {
    // a → b → c，删 b：a 保留，c 保留（不递归删子树），两条边都删
    const nodes = [n('a'), n('b'), n('c')];
    const edges = [e('e1', 'a', 'b'), e('e2', 'b', 'c')];
    const result = removeNodesWithEdges(nodes, edges, ['b']);
    expect(result.nodes.map((x) => x.id)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
  });

  it('should remove multiple nodes at once', () => {
    const nodes = [n('a'), n('b'), n('c'), n('d')];
    const edges = [e('e1', 'a', 'b'), e('e2', 'c', 'd')];
    const result = removeNodesWithEdges(nodes, edges, ['b', 'c']);
    expect(result.nodes.map((x) => x.id)).toEqual(['a', 'd']);
    expect(result.edges).toEqual([]);
  });

  it('should keep unrelated edges intact', () => {
    const nodes = [n('a'), n('b'), n('c'), n('d')];
    const edges = [e('e1', 'a', 'b'), e('e2', 'c', 'd')];
    const result = removeNodesWithEdges(nodes, edges, ['a']);
    expect(result.nodes.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(result.edges.map((x) => x.id)).toEqual(['e2']);
  });

  it('should handle empty ids', () => {
    const nodes = [n('a')];
    const edges = [e('e1', 'a', 'a')];
    const result = removeNodesWithEdges(nodes, edges, []);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });
});
