// backend/src/infrastructure/pubsub/__tests__/EventBus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryEventBus } from '../EventBus.js';
import { DomainEvent } from '../../../domain/_shared/DomainEvent.js';

class TestEvent extends DomainEvent {
  constructor(aggregateId: string, public payload: string) {
    super(aggregateId);
  }
}

class AnotherEvent extends DomainEvent {
  constructor(aggregateId: string, public data: number) {
    super(aggregateId);
  }
}

describe('InMemoryEventBus', () => {
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
  });

  it('should publish and subscribe to specific event type', async () => {
    const handler = vi.fn();
    eventBus.subscribe('TestEvent', handler);

    const event = new TestEvent('test-1', 'hello');
    await eventBus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should support multiple subscribers for same event', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    eventBus.subscribe('TestEvent', handler1);
    eventBus.subscribe('TestEvent', handler2);

    const event = new TestEvent('test-2', 'world');
    await eventBus.publish(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('should not notify unrelated subscribers', async () => {
    const testHandler = vi.fn();
    const anotherHandler = vi.fn();

    eventBus.subscribe('TestEvent', testHandler);
    eventBus.subscribe('AnotherEvent', anotherHandler);

    const event = new TestEvent('test-3', 'test');
    await eventBus.publish(event);

    expect(testHandler).toHaveBeenCalledWith(event);
    expect(anotherHandler).not.toHaveBeenCalled();
  });

  it('should allow unsubscribing', async () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.subscribe('TestEvent', handler);

    const event1 = new TestEvent('test-4', 'first');
    await eventBus.publish(event1);
    expect(handler).toHaveBeenCalledTimes(1);

    // 取消订阅
    unsubscribe();

    const event2 = new TestEvent('test-5', 'second');
    await eventBus.publish(event2);
    expect(handler).toHaveBeenCalledTimes(1); // 没有增加
  });

  it('should support subscribeAll', async () => {
    const globalHandler = vi.fn();
    eventBus.subscribeAll(globalHandler);

    const event1 = new TestEvent('test-6', 'test');
    const event2 = new AnotherEvent('test-7', 42);

    await eventBus.publish(event1);
    await eventBus.publish(event2);

    expect(globalHandler).toHaveBeenCalledTimes(2);
    expect(globalHandler).toHaveBeenNthCalledWith(1, event1);
    expect(globalHandler).toHaveBeenNthCalledWith(2, event2);
  });

  it('should handle handler errors gracefully', async () => {
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const goodHandler = vi.fn();

    eventBus.subscribe('TestEvent', errorHandler);
    eventBus.subscribe('TestEvent', goodHandler);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event = new TestEvent('test-8', 'test');
    await eventBus.publish(event);

    // 错误不应该阻止其他处理器
    expect(goodHandler).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should support async handlers', async () => {
    let completed = false;
    const asyncHandler = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      completed = true;
    });

    eventBus.subscribe('TestEvent', asyncHandler);

    const event = new TestEvent('test-9', 'async');
    await eventBus.publish(event);

    expect(asyncHandler).toHaveBeenCalled();
    expect(completed).toBe(true);
  });
});
