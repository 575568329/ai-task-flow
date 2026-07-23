// backend/src/infrastructure/persistence/TaskFileWatcher.ts
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EventBus } from '../pubsub/EventBus.js';
import { TasksExternallyChanged } from '../../domain/workflow/events/TasksExternallyChanged.js';

/**
 * 轮询监听 tasks.json,让 HTTP 进程感知「外部进程(如 MCP stdio)对文件的写入」,
 * 进而通过 EventBus → SSE 把变更推给前端。
 *
 * 为什么用 fs.watchFile(轮询)而非 fs.watch(事件驱动):
 *   fs.watch 跨进程监听不可靠——外部进程写入时易丢事件/丢句柄(Node #47058),
 *   Windows 单次写还会多次触发(Node #3042)。轮询主动 stat,跨进程 100% 可靠,
 *   单文件 1s 开销可忽略;代价是 ~1s 延迟,对「回写后刷新」无感知。
 *
 * 自写区分(防回环、防重复推送):
 *   本进程 JsonTaskRepository 写完文件后调 markSelfWrite 刷新基线;
 *   轮询发现 mtime 变化时读出内容与基线比对——一致即「自己刚写的」,忽略;
 *   不一致才是外部写入,发 TasksExternallyChanged 让前端全量重拉。
 */
export class TaskFileWatcher {
  private lastRaw = '';

  constructor(
    private readonly filePath: string,
    private readonly eventBus: EventBus,
  ) {}

  /** 启动轮询。intervalMs 默认 1000ms(单文件、数据量小,延迟可接受)。 */
  async start(intervalMs = 1000): Promise<void> {
    this.lastRaw = await this.readRaw();
    fs.watchFile(this.filePath, { interval: intervalMs, persistent: false }, (cur, prev) => {
      // mtime/size 都没变就不读文件,减少无谓 IO
      if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
      void this.check();
    });
  }

  /** 本进程刚写完 tasks.json 后调用:刷新基线,使随后的轮询判定为「自写」并忽略。 */
  markSelfWrite(raw: string): void {
    this.lastRaw = raw;
  }

  stop(): void {
    fs.unwatchFile(this.filePath);
  }

  private async check(): Promise<void> {
    const raw = await this.readRaw();
    if (raw === this.lastRaw) return; // 自写或无实质变化
    this.lastRaw = raw;
    await this.eventBus.publish(new TasksExternallyChanged());
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.filePath, 'utf-8');
    } catch {
      // 文件不存在或瞬时不可读:视作空基线,等下次写入再触发
      return '';
    }
  }
}
