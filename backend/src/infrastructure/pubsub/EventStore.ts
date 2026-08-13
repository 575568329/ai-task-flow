// backend/src/infrastructure/pubsub/EventStore.ts
import { DomainEvent } from '../../domain/_shared/DomainEvent.js';
import fs from 'fs/promises';
import path from 'path';
import { eventsFilePath } from '../../config/dataDir.js';

/** 事件文件大小上限(P2-26 轮转):超此 rename 为 .jsonl.1,getAllEvents 合并主+.1 保留近期两段审计。 */
const MAX_EVENTS_SIZE = 50 * 1024 * 1024; // 50 MB(事件比日志重要,上限更大)

/**
 * EventStore 接口
 * 用于持久化领域事件，支持事件溯源和审计
 */
export interface EventStore {
  /**
   * 保存事件
   */
  append(event: DomainEvent): Promise<void>;

  /**
   * 获取所有事件
   */
  getAllEvents(): Promise<DomainEvent[]>;

  /**
   * 获取指定聚合根的事件
   */
  getEventsByAggregateId(aggregateId: string): Promise<DomainEvent[]>;

  /**
   * 获取指定类型的事件
   */
  getEventsByType(eventType: string): Promise<DomainEvent[]>;
}

/**
 * JSON 文件版 EventStore
 * MVP 阶段使用，事件追加到 JSON Lines 文件
 */
export class JsonEventStore implements EventStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || eventsFilePath();
  }

  async append(event: DomainEvent): Promise<void> {
    // 确保目录存在
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // 大小轮转(P2-26):超上限 rename → .1,防审计日志无限增长撑满磁盘。
    // getAllEvents 合并主 + .1,保留近期两段历史(不丢审计)。
    await this.maybeRotate();
    // 追加事件到文件（JSON Lines 格式）
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');
  }

  /** 大小轮转:stat 超 MAX_EVENTS_SIZE 则 rename → .1(覆盖旧备份,只保留 1 个)。ENOENT 忽略。 */
  private async maybeRotate(): Promise<void> {
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size >= MAX_EVENTS_SIZE) {
        await fs.rename(this.filePath, `${this.filePath}.1`);
      }
    } catch {
      // 文件不存在(首次写)或 stat 失败:忽略,照常 append
    }
  }

  async getAllEvents(): Promise<DomainEvent[]> {
    // 合并 .1 备份(旧,轮转来的) + 主文件(新),保留近期两段审计历史
    const events: DomainEvent[] = [];
    for (const f of [`${this.filePath}.1`, this.filePath]) {
      try {
        const content = await fs.readFile(f, 'utf-8');
        if (content.trim()) {
          for (const line of content.trim().split('\n')) {
            events.push(JSON.parse(line));
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return events;
  }

  async getEventsByAggregateId(aggregateId: string): Promise<DomainEvent[]> {
    const allEvents = await this.getAllEvents();
    return allEvents.filter(event => event.aggregateId === aggregateId);
  }

  async getEventsByType(eventType: string): Promise<DomainEvent[]> {
    const allEvents = await this.getAllEvents();
    return allEvents.filter(event => event.eventType === eventType);
  }
}
