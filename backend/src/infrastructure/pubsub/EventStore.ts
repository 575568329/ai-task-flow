// backend/src/infrastructure/pubsub/EventStore.ts
import { DomainEvent } from '../../domain/_shared/DomainEvent.js';
import fs from 'fs/promises';
import path from 'path';
import { eventsFilePath } from '../../config/dataDir.js';

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

    // 追加事件到文件（JSON Lines 格式）
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');
  }

  async getAllEvents(): Promise<DomainEvent[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) {
        return [];
      }

      const lines = content.trim().split('\n');
      return lines.map(line => JSON.parse(line));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
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
