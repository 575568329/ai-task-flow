// backend/src/application/mindmap/__tests__/MindmapService.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { JsonMindmapRepository } from '../../../infrastructure/persistence/JsonMindmapRepository.js';
import {
  MindmapConflictError,
  MindmapNotFoundError,
  MindmapService,
  MindmapValidationError,
} from '../MindmapService.js';
import type { MindmapFlowNode } from '@ai-task-flow/shared';

function node(id: string, label = id): MindmapFlowNode {
  return { id, position: { x: 0, y: 0 }, data: { label, level: 1 } };
}

describe('MindmapService', () => {
  let service: MindmapService;
  let repo: JsonMindmapRepository;
  let testPath: string;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    testPath = path.join(os.tmpdir(), `test-mindmaps-${nanoid()}.json`);
    repo = new JsonMindmapRepository(testPath);
    service = new MindmapService(repo);
  });

  afterEach(async () => {
    // 清理主文件 + 原子写残留的 .tmp
    for (const p of [testPath, `${testPath}.tmp`]) {
      try {
        await fs.unlink(p);
      } catch {
        /* 忽略不存在 */
      }
    }
  });

  describe('createMindmap', () => {
    it('创建含默认根节点的文档', async () => {
      const doc = await service.createMindmap({ title: '测试图' });
      expect(doc.title).toBe('测试图');
      expect(doc.nodes).toHaveLength(1);
      expect(doc.version).toBe(0);
      expect(doc.nodeCount).toBe(1);
    });

    it('无 title 走默认值', async () => {
      const doc = await service.createMindmap({});
      expect(doc.title).toBe('未命名思维导图');
    });
  });

  describe('getMindmap', () => {
    it('不存在抛 NotFoundError', async () => {
      await expect(service.getMindmap('no-exist')).rejects.toBeInstanceOf(MindmapNotFoundError);
    });
  });

  describe('updateMindmap - 乐观锁', () => {
    it('版本匹配时更新成功，version 自增', async () => {
      const doc = await service.createMindmap({});
      const updated = await service.updateMindmap(doc.id, { title: '新标题', expectedVersion: 0 });
      expect(updated.title).toBe('新标题');
      expect(updated.version).toBe(1);
    });

    it('版本不匹配抛 ConflictError', async () => {
      const doc = await service.createMindmap({});
      await expect(
        service.updateMindmap(doc.id, { expectedVersion: 999 }),
      ).rejects.toBeInstanceOf(MindmapConflictError);
    });

    it('不传 expectedVersion 不校验版本（兼容首次保存）', async () => {
      const doc = await service.createMindmap({});
      const updated = await service.updateMindmap(doc.id, { title: '无锁更新' });
      expect(updated.title).toBe('无锁更新');
    });
  });

  describe('updateMindmap - 图校验', () => {
    it('重复 node id 抛 ValidationError', async () => {
      const doc = await service.createMindmap({});
      const rootId = doc.nodes[0].id;
      await expect(
        service.updateMindmap(doc.id, { nodes: [...doc.nodes, node(rootId)] }),
      ).rejects.toBeInstanceOf(MindmapValidationError);
    });

    it('edge 引用不存在节点抛 ValidationError', async () => {
      const doc = await service.createMindmap({});
      await expect(
        service.updateMindmap(doc.id, {
          edges: [{ id: 'e1', source: doc.nodes[0].id, target: '不存在' }],
        }),
      ).rejects.toBeInstanceOf(MindmapValidationError);
    });

    it('合法图更新后 nodeCount 同步', async () => {
      const doc = await service.createMindmap({});
      const rootId = doc.nodes[0].id;
      const updated = await service.updateMindmap(doc.id, {
        nodes: [...doc.nodes, node('c1'), node('c2')],
        edges: [
          { id: 'e1', source: rootId, target: 'c1' },
          { id: 'e2', source: rootId, target: 'c2' },
        ],
      });
      expect(updated.nodeCount).toBe(3);
    });
  });

  describe('listMindmaps', () => {
    it('按 updatedAt 倒序排列', async () => {
      const a = await service.createMindmap({ title: 'A' });
      await new Promise(r => setTimeout(r, 10));
      const b = await service.createMindmap({ title: 'B' });
      const list = await service.listMindmaps();
      expect(list.total).toBe(2);
      expect(list.items[0].id).toBe(b.id);
      expect(list.items[1].id).toBe(a.id);
      // meta 不含 nodes/edges 大字段
      expect(list.items[0]).not.toHaveProperty('nodes');
    });
  });

  describe('duplicateMindmap', () => {
    it('复制为新文档（新 id + 标题加副本 + 图内容一致）', async () => {
      const doc = await service.createMindmap({ title: '原图' });
      const rootId = doc.nodes[0].id;
      await service.updateMindmap(doc.id, {
        nodes: [...doc.nodes, node('c1')],
        edges: [{ id: 'e1', source: rootId, target: 'c1' }],
      });
      const dup = await service.duplicateMindmap(doc.id);
      expect(dup.id).not.toBe(doc.id);
      expect(dup.title).toBe('原图 副本');
      expect(dup.nodes).toHaveLength(2);
      expect(dup.version).toBe(1); // create(0) + applyUpdate(1)
    });

    it('源不存在抛 NotFoundError', async () => {
      await expect(service.duplicateMindmap('no-exist')).rejects.toBeInstanceOf(MindmapNotFoundError);
    });
  });

  describe('deleteMindmap', () => {
    it('删除后 getMindmap 抛 NotFound', async () => {
      const doc = await service.createMindmap({});
      await service.deleteMindmap(doc.id);
      await expect(service.getMindmap(doc.id)).rejects.toBeInstanceOf(MindmapNotFoundError);
    });

    it('删除不存在抛 NotFound', async () => {
      await expect(service.deleteMindmap('no-exist')).rejects.toBeInstanceOf(MindmapNotFoundError);
    });
  });

  describe('原子写', () => {
    it('保存后不残留 .tmp 临时文件', async () => {
      const doc = await service.createMindmap({ title: '原子写' });
      await service.updateMindmap(doc.id, { title: '改' });
      const tmpExists = await fs
        .access(`${testPath}.tmp`)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);
    });
  });

  describe('持久化往返', () => {
    it('更新后重开 repo 能读到最新内容', async () => {
      const doc = await service.createMindmap({ title: '持久化' });
      await service.updateMindmap(doc.id, { title: '改过的' });
      // 模拟「重新打开」（新 repo 实例读同一文件）
      const repo2 = new JsonMindmapRepository(testPath);
      const service2 = new MindmapService(repo2);
      const reloaded = await service2.getMindmap(doc.id);
      expect(reloaded.title).toBe('改过的');
      expect(reloaded.version).toBe(1);
    });
  });
});
