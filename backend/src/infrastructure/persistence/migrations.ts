// backend/src/infrastructure/persistence/migrations.ts
// mindmaps.json 顶层 schemaVersion 迁移机制。
//
// 版本号由 repository 包装层读写（聚合根 MindmapDoc 保持纯净，不改 toJSON/fromJSON）。
// 每个迁移是 { from, to, migrate }：从 from 版本升到 to 版本，返回升版后的数据。
// 加新版本时在数组末尾追加（保持链式连续：to(n) 必须等于 to(n+1) 的 from）。
// migrate 必须幂等可重跑（同一份数据跑两次结果一致），失败时抛错由调用方决定不落盘。

interface Migrationable {
  schemaVersion?: number;
  documents: unknown[];
}

interface Migration<T extends Migrationable> {
  from: number;
  to: number;
  migrate: (data: T) => T;
}

/**
 * v0 → v1：加 schemaVersion 字段（数据本身无变化）。
 * v0 = 旧格式（无 schemaVersion），v1 = 显式版本化起点。
 */
const V0_TO_V1: Migration<Migrationable> = {
  from: 0,
  to: 1,
  migrate: (data) => data,
};

const MIGRATIONS: Array<Migration<Migrationable>> = [V0_TO_V1];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce((v, m) => m.to, 0);

/**
 * 把数据从 currentVersion 逐级升到最新版本。未知更高版本原样返回（向后兼容新版本数据，
 * round-trip 容忍：未知字段/版本不丢）。
 */
export function applyMigrations<T extends Migrationable>(data: T, currentVersion: number): T {
  let version = currentVersion;
  let result: Migrationable = data;
  for (const m of MIGRATIONS) {
    if (version === m.from) {
      result = m.migrate(result);
      version = m.to;
    }
  }
  return result as T;
}

/** 读取数据里的 schemaVersion（缺省视为 0）并升到最新 */
export function migrateToCurrent<T extends Migrationable>(data: T): T {
  return applyMigrations(data, data.schemaVersion ?? 0);
}
