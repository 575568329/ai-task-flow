// backend/src/infrastructure/persistence/__tests__/migrations.test.ts
// schemaVersion 迁移机制单测：版本升级 + 幂等 + 未知版本容忍
import { describe, it, expect } from 'vitest';
import { applyMigrations, migrateToCurrent, CURRENT_SCHEMA_VERSION } from '../migrations.js';

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
