// backend/src/infrastructure/persistence/__tests__/migrations.test.ts
// schemaVersion 迁移机制单测：版本升级 + 幂等 + 未知版本容忍 + 仓储级落盘
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyMigrations, migrateToCurrent, CURRENT_SCHEMA_VERSION } from '../migrations.js';
import { JsonMindmapRepository } from '../JsonMindmapRepository.js';
import type { MindmapDoc } from '../../../domain/mindmap/entities/MindmapDoc.js';

describe('applyMigrations', () => {
  it('should migrate v0 (no version) to current', () => {
    const data = { documents: [{ id: 'a' }] };
    const result = applyMigrations(data, 0);
    expect(result).toBe(data); // v0→v1 数据无变化（同一引用）
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('should pass through data already at current version', () => {
    const data = { schemaVersion: CURRENT_SCHEMA_VERSION, documents: [] };
    expect(applyMigrations(data, CURRENT_SCHEMA_VERSION)).toBe(data);
  });

  it('should tolerate unknown higher version (round-trip)', () => {
    // 未来版本写的数据：原样返回不丢
    const future = { schemaVersion: 99, documents: [{ id: 'x', fromFuture: true }] };
    const result = applyMigrations(future as never, 99);
    expect(result).toBe(future);
  });
});

describe('migrateToCurrent', () => {
  it('should treat missing schemaVersion as v0 and migrate', () => {
    const data = { documents: [] };
    const result = migrateToCurrent(data);
    expect(result.documents).toEqual([]);
  });

  it('should be idempotent (running twice yields same result)', () => {
    const data = { documents: [{ id: 'a', nodes: [], edges: [] }] };
    const once = migrateToCurrent(data);
    const twice = migrateToCurrent(once);
    expect(twice).toEqual(once);
  });
});

describe('JsonMindmapRepository schemaVersion（仓储级）', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mig-test-'));
    file = path.join(dir, 'mindmaps.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should read legacy v0 file (no schemaVersion) and stamp version on save', async () => {
    // 手工写旧格式文件（迁移机制针对的真实场景）
    const legacy = {
      documents: [
        {
          id: 'legacy-1',
          title: '旧文档',
          version: 3,
          nodeCount: 1,
          nodes: [{ id: 'r', type: 'mindmap', position: { x: 0, y: 0 }, data: { label: '根', level: 0 } }],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(legacy), 'utf-8');

    const repo = new JsonMindmapRepository(file);
    const docs = await repo.findAll();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('旧文档');

    // 触发一次写 → 文件补上 schemaVersion
    const doc = await repo.findById('legacy-1');
    await repo.save(doc as MindmapDoc);
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.documents[0].title).toBe('旧文档'); // 数据未丢
  });

  it('should NOT downgrade future version on save (R4)', async () => {
    // 未来版本（v99）文件：读容忍 + 写不降级
    const future = {
      schemaVersion: 99,
      documents: [
        {
          id: 'future-1',
          title: '未来文档',
          version: 1,
          nodeCount: 0,
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(future), 'utf-8');

    const repo = new JsonMindmapRepository(file);
    const doc = await repo.findById('future-1');
    await repo.save(doc as MindmapDoc);

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.schemaVersion).toBe(99); // 不被降级盖章为 CURRENT
  });
});
