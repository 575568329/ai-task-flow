// backend/src/domain/mindmap/__tests__/MindmapDoc.test.ts
import { describe, it, expect } from 'vitest';
import { MindmapDoc } from '../entities/MindmapDoc.js';
import { MINDMAP_LIMITS } from '@ai-task-flow/shared';
import type { MindmapFlowNode } from '@ai-task-flow/shared';

/** 构造一个最小合法节点 */
function node(id: string, label = id, level = 1): MindmapFlowNode {
  return { id, position: { x: 0, y: 0 }, data: { label, level } };
}

describe('MindmapDoc', () => {
  describe('create', () => {
    it('应生成默认根节点（level 0）', () => {
      const doc = MindmapDoc.create();
      expect(doc.id).toBeTruthy();
      expect(doc.title).toBe('未命名思维导图');
      expect(doc.version).toBe(0);
      expect(doc.nodes).toHaveLength(1);
      expect(doc.nodes[0].data.level).toBe(0);
      expect(doc.nodeCount).toBe(1);
      expect(doc.edges).toHaveLength(0);
    });

    it('传入标题时根节点 label 跟随', () => {
      const doc = MindmapDoc.create('项目拆解');
      expect(doc.title).toBe('项目拆解');
      expect(doc.nodes[0].data.label).toBe('项目拆解');
    });

    it('空/空白标题走默认值，根节点 label 用中心主题', () => {
      const doc = MindmapDoc.create('   ');
      expect(doc.title).toBe('未命名思维导图');
      expect(doc.nodes[0].data.label).toBe('中心主题');
    });

    it('超长标题应截断到上限', () => {
      const long = 'a'.repeat(MINDMAP_LIMITS.MAX_TITLE_LENGTH + 50);
      const doc = MindmapDoc.create(long);
      expect(doc.title).toHaveLength(MINDMAP_LIMITS.MAX_TITLE_LENGTH);
    });
  });

  describe('rename', () => {
    it('trim + 空走默认', () => {
      const doc = MindmapDoc.create('原');
      doc.rename('  新标题  ');
      expect(doc.title).toBe('新标题');
      doc.rename('');
      expect(doc.title).toBe('未命名思维导图');
    });
  });

  describe('applyUpdate - 图校验', () => {
    it('合法 nodes/edges 更新通过，version 自增 + nodeCount 同步', () => {
      const doc = MindmapDoc.create();
      const rootId = doc.nodes[0].id;
      const childId = 'child-1';
      doc.applyUpdate({
        nodes: [...doc.nodes, node(childId)],
        edges: [{ id: 'e1', source: rootId, target: childId }],
      });
      expect(doc.version).toBe(1);
      expect(doc.nodeCount).toBe(2);
      expect(doc.nodes).toHaveLength(2);
    });

    it('仅更新 title 也自增 version', () => {
      const doc = MindmapDoc.create();
      doc.applyUpdate({ title: '新标题' });
      expect(doc.version).toBe(1);
      expect(doc.title).toBe('新标题');
    });

    it('重复 node id 抛错', () => {
      const doc = MindmapDoc.create();
      const rootId = doc.nodes[0].id;
      expect(() => doc.applyUpdate({ nodes: [...doc.nodes, node(rootId)] })).toThrow(/重复/);
    });

    it('空 node id 抛错', () => {
      const doc = MindmapDoc.create();
      expect(() => doc.applyUpdate({ nodes: [...doc.nodes, node('')] })).toThrow(/id 为空/);
    });

    it('edge target 引用不存在节点抛错', () => {
      const doc = MindmapDoc.create();
      expect(() =>
        doc.applyUpdate({ edges: [{ id: 'e1', source: doc.nodes[0].id, target: '不存在' }] }),
      ).toThrow(/target/);
    });

    it('edge source 引用不存在节点抛错', () => {
      const doc = MindmapDoc.create();
      expect(() =>
        doc.applyUpdate({ edges: [{ id: 'e1', source: '不存在', target: doc.nodes[0].id }] }),
      ).toThrow(/source/);
    });

    it('节点数超上限抛错', () => {
      const doc = MindmapDoc.create();
      const tooMany = Array.from({ length: MINDMAP_LIMITS.MAX_NODES_PER_DOC + 1 }, (_, i) =>
        node(`n${i}`),
      );
      expect(() => doc.applyUpdate({ nodes: tooMany })).toThrow(/上限/);
    });

    it('viewport 更新应覆盖', () => {
      const doc = MindmapDoc.create();
      doc.applyUpdate({ viewport: { x: 10, y: 20, zoom: 0.8 } });
      expect(doc.viewport).toEqual({ x: 10, y: 20, zoom: 0.8 });
    });
  });

  describe('toJSON / fromJSON 往返', () => {
    it('无损往返（含 nodes/edges/version）', () => {
      const doc = MindmapDoc.create('往返测试');
      const rootId = doc.nodes[0].id;
      doc.applyUpdate({
        nodes: [...doc.nodes, node('c1')],
        edges: [{ id: 'e1', source: rootId, target: 'c1' }],
        viewport: { x: 1, y: 2, zoom: 1 },
      });
      const json = doc.toJSON();
      const restored = MindmapDoc.fromJSON(json);
      expect(restored.id).toBe(doc.id);
      expect(restored.title).toBe(doc.title);
      expect(restored.version).toBe(doc.version);
      expect(restored.nodeCount).toBe(doc.nodeCount);
      expect(restored.nodes).toEqual(doc.nodes);
      expect(restored.edges).toEqual(doc.edges);
      expect(restored.viewport).toEqual(doc.viewport);
    });
  });
});
