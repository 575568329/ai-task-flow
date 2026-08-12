// frontend/src/components/mindmap/OutlinePanel.test.ts
// 大纲树构建测试：buildOutlineTree 的空/单根/嵌套/多分支。
import { describe, it, expect } from 'vitest';
import { buildOutlineTree } from './OutlinePanel';
import type { Node, Edge } from '@xyflow/react';

const n = (id: string, label = id, level = 0): Node => ({
  id,
  type: 'mindmap',
  position: { x: 0, y: 0 },
  data: { label, level },
});
const e = (id: string, s: string, t: string): Edge => ({
  id,
  source: s,
  target: t,
  type: 'mindmap',
});

describe('buildOutlineTree', () => {
  it('空节点返回 null', () => {
    expect(buildOutlineTree([], [])).toBeNull();
  });

  it('单根节点（无边）返回单节点树', () => {
    const tree = buildOutlineTree([n('root')], []);
    expect(tree).not.toBeNull();
    expect(tree!.id).toBe('root');
    expect(tree!.children).toHaveLength(0);
  });

  it('嵌套树：root → a/b → a 的子 c', () => {
    const tree = buildOutlineTree(
      [n('root', '根', 0), n('a', 'A', 1), n('b', 'B', 1), n('c', 'C', 2)],
      [e('e1', 'root', 'a'), e('e2', 'root', 'b'), e('e3', 'a', 'c')],
    );
    expect(tree!.id).toBe('root');
    expect(tree!.children).toHaveLength(2);
    const a = tree!.children.find((c) => c.id === 'a')!;
    expect(a.children).toHaveLength(1);
    expect(a.children[0].id).toBe('c');
    const b = tree!.children.find((c) => c.id === 'b')!;
    expect(b.children).toHaveLength(0);
  });

  it('label 取自 node.data.label', () => {
    const tree = buildOutlineTree([n('x', '标题')], []);
    expect(tree!.label).toBe('标题');
  });

  it('多分支：root 的 3 个直接子节点', () => {
    const tree = buildOutlineTree(
      [n('root'), n('a'), n('b'), n('c')],
      [e('e1', 'root', 'a'), e('e2', 'root', 'b'), e('e3', 'root', 'c')],
    );
    expect(tree!.children.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});
