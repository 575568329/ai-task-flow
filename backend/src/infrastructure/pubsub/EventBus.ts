// backend/src/infrastructure/pubsub/EventBus.ts
import { DomainEvent } from '../../domain/_shared/DomainEvent.js';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * EventBus 接口
 * 用于模块间解耦通信（MCP Server → HTTP Server → 前端 SSE）
 */
export interface EventBus {
  /**
   * 发布事件
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * 订阅事件
   * @param eventType 事件类型（例如 'TaskDispatched'）
   * @param handler 事件处理器
   * @returns 取消订阅的函数
   */
  subscribe(eventType: string, handler: EventHandler): () => void;

  /**
   * 订阅所有事件
   */
  subscribeAll(handler: EventHandler): () => void;
}

/**
 * 内存版 EventBus
 * MVP 阶段使用，进程内通信
 */
export class InMemoryEventBus implements EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private allHandlers: Set<EventHandler> = new Set();

  async publish(event: DomainEvent): Promise<void> {
    // 通知特定类型的订阅者
    const typeHandlers = this.handlers.get(event.eventType);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event);
        } catch (error) {
          console.error(`[EventBus] Handler error for ${event.eventType}:`, error);
        }
      }
    }

    // 通知全局订阅者
    for (const handler of this.allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[EventBus] Global handler error:`, error);
      }
    }
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(eventType);
        }
      }
    };
  }

  subscribeAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler);

    // 返回取消订阅函数
    return () => {
      this.allHandlers.delete(handler);
    };
  }
}
