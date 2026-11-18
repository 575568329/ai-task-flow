// 结论卡仓储：双层锁 + 锁内重读 + 原子写 + 破坏性操作前快照。
// 与 JsonWorklogRepository 同协议；HTTP 与 MCP 是两个进程，缺一不可。
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import type { ConclusionData } from '@ai-task-flow/shared';
import { JsonRepository } from './JsonRepository.js';
import type {
  ConclusionMutateOptions,
  ConclusionRepository,
} from '../../domain/conclusion/repositories/ConclusionRepository.js';
import { ConclusionStorageError } from '../../domain/conclusion/errors.js';

const MAX_BACKUPS = 10;
const LOCK_RETRIES = { retries: 20, factor: 1.5, minTimeout: 100, maxTimeout: 2000 };
const LOCK_STALE_MS = 30_000;

export class JsonConclusionRepository extends JsonRepository implements ConclusionRepository {
  private readonly backupsDir: string;

  constructor(filePath: string, backupsDir: string) {
    super(filePath);
    this.backupsDir = backupsDir;
  }

  async load(): Promise<ConclusionData> {
    const raw = await this.read();
    if (!raw || !raw.trim()) return { schemaVersion: 1, conclusions: [] };
    let parsed: ConclusionData;
    try {
      parsed = JSON.parse(raw) as ConclusionData;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConclusionStorageError(`结论数据文件损坏（${this.filePath}）：${message}`);
    }
    if (!parsed || !Array.isArray(parsed.conclusions)) {
      return { schemaVersion: 1, conclusions: [] };
    }
    return { schemaVersion: 1, conclusions: parsed.conclusions };
  }

  async mutate<T>(
    fn: (data: ConclusionData) => T | Promise<T>,
    options?: ConclusionMutateOptions,
  ): Promise<T> {
    return this.withWriteLock(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await lockfile.lock(this.filePath, {
        realpath: false,
        retries: LOCK_RETRIES,
        stale: LOCK_STALE_MS,
      });
      try {
        const data = await this.load();
        if (options?.backup) await this.snapshot(data);
        const result = await fn(data);
        await this.writeAtomic(JSON.stringify(data, null, 2));
        return result;
      } finally {
        await lockfile.unlock(this.filePath).catch((err: unknown) => {
          console.warn('[ConclusionRepository] unlock 失败（可能锁已被抢占）:', err);
        });
      }
    });
  }

  private writeAtomic(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      writeFileAtomic(this.filePath, text, 'utf-8', (err) => (err ? reject(err) : resolve()));
    });
  }

  private async snapshot(data: ConclusionData): Promise<void> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const ts =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
    const rand = Math.random().toString(36).slice(2, 6);
    await fs.writeFile(
      path.join(this.backupsDir, `backup-${ts}_${rand}.json`),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
    await this.pruneBackups();
  }

  private async pruneBackups(): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.backupsDir)).filter((n) => n.startsWith('backup-')).sort();
    } catch {
      return;
    }
    const excess = names.length - MAX_BACKUPS;
    for (let i = 0; i < excess; i++) {
      await fs.unlink(path.join(this.backupsDir, names[i])).catch(() => {});
    }
  }
}
