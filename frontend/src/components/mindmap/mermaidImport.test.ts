// frontend/src/components/mindmap/mermaidImport.test.ts
// mermaid 子集 parser 单测：基本图/链式/环/多父/中文/形状/边标签/容错
import { describe, it, expect } from 'vitest';
import { parseMermaidFlowchart, toCanvasDraft } from './mermaidImport';

describe('parseMermaidFlowchart', () => {
  it('should parse basic flowchart with labels', () => {
    const r = parseMermaidFlowchart(`
flowchart LR
  A[开始] --> B[处理]
  B --> C{判断}
  C --> D[结束]
`)!;
    expect(r).not.toBeNull();
    expect(r.nodes.map((n) => n.label)).toEqual(['开始', '处理', '判断', '结束']);
    expect(r.edges).toHaveLength(3);
    expect(r.edges[0]).toEqual({ from: 'A', to: 'B', label: undefined });
  });

  it('should parse chained edges in one line', () => {
    const r = parseMermaidFlowchart('graph TD\n A --> B --> C')!;
    expect(r.edges).toHaveLength(2);
    expect(r.edges[1].to).toBe('C');
  });

  it('should support cycles and multiple parents', () => {
    const r = parseMermaidFlowchart(`
flowchart LR
  A --> B
  B --> C
  C --> A
  D --> B
`)!;
    // A→B→C→A 环 + D 多父指向 B
    expect(r.edges).toHaveLength(4);
    expect(r.edges[2]).toEqual({ from: 'C', to: 'A', label: undefined });
  });

  it('should parse edge labels with |text|', () => {
    const r = parseMermaidFlowchart('flowchart LR\n A -->|是| B\n B ---|否| C')!;
    expect(r.edges[0].label).toBe('是');
    expect(r.edges[1].label).toBe('否');
  });

  it('should support dashed and thick arrows', () => {
    const r = parseMermaidFlowchart('flowchart LR\n A -.-> B\n B ==> C')!;
    expect(r.edges).toHaveLength(2);
  });

  it('should use id as label when no shape text', () => {
    const r = parseMermaidFlowchart('flowchart LR\n start --> end')!;
    expect(r.nodes.map((n) => n.label)).toEqual(['start', 'end']);
  });

  it('should support Chinese ids and labels', () => {
    const r = parseMermaidFlowchart('flowchart LR\n 开始[初始化] --> 结束[完成]')!;
    expect(r.nodes.map((n) => n.label)).toEqual(['初始化', '完成']);
    expect(r.edges[0].from).toBe('开始');
  });

  it('later duplicate id overrides label (mermaid semantics)', () => {
    const r = parseMermaidFlowchart('flowchart LR\n A[旧] --> B\n A[新]')!;
    expect(r.nodes.find((n) => n.id === 'A')!.label).toBe('新');
    expect(r.nodes).toHaveLength(2);
  });

  it('should skip comments/subgraph/style lines', () => {
    const r = parseMermaidFlowchart(`
%% 这是注释
flowchart LR
  subgraph 组
    A --> B
  end
  style A fill:#f9f
  class A bold
  B --> C
`)!;
    expect(r.edges).toHaveLength(2);
    expect(r.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
  });

  it('should tolerate unknown characters (best effort)', () => {
    const r = parseMermaidFlowchart('flowchart LR\n @#$ A --> B')!;
    expect(r.nodes).toHaveLength(2);
  });

  it('should return null for empty or non-diagram text', () => {
    expect(parseMermaidFlowchart('')).toBeNull();
    expect(parseMermaidFlowchart('hello world')).toBeNull();
    expect(parseMermaidFlowchart('%% only comment')).toBeNull();
  });

  it('should keep isolated nodes (no edges)', () => {
    const r = parseMermaidFlowchart('flowchart LR\n A[孤立]\n B[落单]')!;
    expect(r.nodes).toHaveLength(2);
    expect(r.edges).toHaveLength(0);
  });
});

describe('toCanvasDraft', () => {
  it('should produce new uuids, layouted positions and typed edges', () => {
    const parsed = parseMermaidFlowchart('flowchart LR\n A[开始] --> B --> C')!;
    const draft = toCanvasDraft(parsed, { x: 1000, y: 2000 });
    expect(draft.nodes).toHaveLength(3);
    expect(draft.edges).toHaveLength(2);
    // 新 id（不与 mermaid id 相同）
    expect(draft.nodes.every((n) => n.id !== 'A' && n.id !== 'B')).toBe(true);
    // 布局 + 锚点偏移：根节点位于锚点
    const root = draft.nodes.find((n) => n.data?.label === '开始')!;
    expect(root.position.x).toBe(1000);
    expect(root.position.y).toBeGreaterThanOrEqual(2000);
    // 边引用映射后的新 id
    expect(draft.edges.every((e) => draft.nodes.some((n) => n.id === e.source))).toBe(true);
    expect(draft.edges[0].type).toBe('mindmap');
    expect(draft.edges[0].sourceHandle).toBe('right');
  });

  it('should keep edge labels in data', () => {
    const parsed = parseMermaidFlowchart('flowchart LR\n A -->|是| B')!;
    const draft = toCanvasDraft(parsed, { x: 0, y: 0 });
    expect((draft.edges[0].data as { label?: string }).label).toBe('是');
  });
});
