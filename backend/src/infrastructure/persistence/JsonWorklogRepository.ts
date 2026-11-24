// backend/src/infrastructure/persistence/JsonWorklogRepository.ts
// worklog 仓储实现:双层锁写协议(设计 §4.1)。
//
// 为什么不是单层:HTTP backend 与 MCP(stdio)是两个 OS 进程,各持一个本类实例——
//   1) 进程内:复用 JsonRepository.withWriteLock(promise-chain mutex),Fastify 并发请求先排队,
//      不直接撞文件锁(ELOCKED → HTTP 500);
//   2) 跨进程:进程内临界区再取 proper-lockfile 文件锁(mkdir 原子策略,任何文件系统可靠,
//      自带 stale 恢复),锁内**重读**最新数据再变更,杜绝两个进程 read-modify-write 互相覆盖。
//
// 读侧:每次 load 直读磁盘不缓存——write-file-atomic 的同目录 tmp+rename 原子替换保证
// 读者永远读到完整的旧版或新版,无撕裂;MCP 进程刚写入的条目,本进程下次读取即见。
//
// 备份:破坏性操作(mutate options.backup=true)在锁内重读之后、写回之前整文件快照,
// 滚动保留最近 10 份(快照含他进程刚提交的更新,恢复不丢数据)。
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import type { WorklogData, WorklogProject } from '@ai-task-flow/shared';
import { JsonRepository } from './JsonRepository.js';
import type { WorklogMutateOptions, WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';

/** 滚动保留的快照份数 */
const MAX_BACKUPS = 10;

/** 文件锁竞争重试:总等待上限约 30s,超限抛 ELOCKED(由调用方映射 HTTP 409/503 或 MCP isError) */
const LOCK_RETRIES = { retries: 20, factor: 1.5, minTimeout: 100, maxTimeout: 2000 };

/** stale 阈值:超过此时长的锁视为持锁进程已崩溃,可被抢占(默认 10s 在慢盘/杀毒扫描下偏小) */
const LOCK_STALE_MS = 30_000;

export class JsonWorklogRepository extends JsonRepository implements WorklogRepository {
  private readonly backupsDir: string;

  constructor(filePath: string, backupsDir: string) {
    super(filePath);
    this.backupsDir = backupsDir;
  }

  /** 读最新数据(不缓存)。文件不存在/空 → 空结构。 */
  async load(): Promise<WorklogData> {
    const raw = await this.read();
    if (!raw || !raw.trim()) return { projects: [], programs: [], versions: [] };
    const parsed = JSON.parse(raw) as WorklogData;
    // 顶层字段缺省容错:迁移前的旧文件没有 versions/programs,由迁移服务补齐;
    // 此处归一为空数组,避免服务层读旧文件时 data.versions.find / data.programs 崩溃。
    return {
      projects: parsed.projects ?? [],
      programs: parsed.programs ?? [],
      versions: parsed.versions ?? [],
    };
  }

  async mutate<T>(
    fn: (data: WorklogData) => T | Promise<T>,
    options?: WorklogMutateOptions,
  ): Promise<T> {
    // 第一层:进程内串行(基类 promise-chain mutex)
    return this.withWriteLock(async () => {
      // 目录先行(proper-lockfile 计算 lockpath 时 lstat 父目录,首次写入前目录可能不存在);
      // realpath:false——worklog.json 本身允许尚不存在(默认 realpath 对不存在的文件 ENOENT)
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      // 首次写入前先落空文件:unlock 需要 lstat 目标文件,若事务 fn 在首次写盘前抛错
      // (如 id 不存在的 404),unlock 会因 ENOENT 失败并遗留 .lock,后续事务等锁直到超时。
      // 空文件由 load 视为空结构,不影响语义。
      try {
        await fs.writeFile(this.filePath, '', { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      await lockfile.lock(this.filePath, {
        realpath: false,
        retries: LOCK_RETRIES, stale: LOCK_STALE_MS,
      });
      try {
        // 锁内重读:拿到含其他进程最近提交的最新数据
        const data = await this.load();
        if (options?.backup) {
          await this.snapshot(data);
        }
        const result = await fn(data);
        await this.writeAtomic(JSON.stringify(data, null, 2));
        return result;
      } finally {
        // ECOMPROMISED(锁被 stale 抢占等)不阻塞主流程,记日志由运维侧排查
        await lockfile.unlock(this.filePath).catch((err: unknown) => {
          console.warn('[WorklogRepository] unlock 失败(可能锁已被抢占):', err);
        });
      }
    });
  }

  /** write-file-atomic 原子写:同目录 tmp + fsync + rename,断电不产生半截文件 */
  private writeAtomic(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      writeFileAtomic(this.filePath, text, 'utf-8', (err) => (err ? reject(err) : resolve()));
    });
  }

  /** 破坏性操作前快照:文件名毫秒+随机后缀防同刻互覆;滚动保留 MAX_BACKUPS 份 */
  private async snapshot(data: WorklogData): Promise<void> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const ts =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
    const rand = Math.random().toString(36).slice(2, 6);
    const backupPath = path.join(this.backupsDir, `backup-${ts}_${rand}.json`);
    await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf-8');
    await this.pruneBackups();
  }

  /** 按文件名排序(即时间序)删除超出滚动窗口的旧快照 */
  private async pruneBackups(): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.backupsDir)).filter((n) => n.startsWith('backup-')).sort();
    } catch {
      return; // 目录不可读:跳过清理,不影响主流程
    }
    const excess = names.length - MAX_BACKUPS;
    for (let i = 0; i < excess; i++) {
      await fs.unlink(path.join(this.backupsDir, names[i])).catch(() => {});
    }
  }
}

// 类型再导出:便于 Service 层仅依赖 domain 接口的同时共享 option 类型
export type { WorklogMutateOptions, WorklogRepository, WorklogProject };
