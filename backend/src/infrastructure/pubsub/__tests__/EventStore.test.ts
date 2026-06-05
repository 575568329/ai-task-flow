// backend/src/infrastructure/pubsub/__tests__/EventStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonEventStore } from '../EventStore.js';
import { DomainEvent } from '../../../domain/_shared/DomainEvent.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

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

describe('JsonEventStore', () => {
  let eventStore: JsonEventStore;
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(os.tmpdir(), `test-events-${Date.now()}.jsonl`);
    eventStore = new JsonEventStore(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }
  });

  it('should append and retrieve events', async () => {
    const event1 = new TestEvent('task-1', 'hello');
    const event2 = new TestEvent('task-2', 'world');

    await eventStore.append(event1);
    await eventStore.append(event2);

    const events = await eventStore.getAllEvents();
    expect(events).toHaveLength(2);
    expect(events[0].aggregateId).toBe('task-1');
    expect(events[1].aggregateId).toBe('task-2');
  });

  it('should return empty array when no events exist', async () => {
    const events = await eventStore.getAllEvents();
    expect(events).toEqual([]);
  });

  it('should get events by aggregate ID', async () => {
    const event1 = new TestEvent('task-1', 'first');
    const event2 = new TestEvent('task-2', 'second');
    const event3 = new TestEvent('task-1', 'third');

    await eventStore.append(event1);
    await eventStore.append(event2);
    await eventStore.append(event3);

    const task1Events = await eventStore.getEventsByAggregateId('task-1');
    expect(task1Events).toHaveLength(2);
    expect(task1Events[0].aggregateId).toBe('task-1');
    expect(task1Events[1].aggregateId).toBe('task-1');
  });

  it('should get events by event type', async () => {
    const event1 = new TestEvent('task-1', 'test');
    const event2 = new AnotherEvent('task-2', 42);
    const event3 = new TestEvent('task-3', 'test2');

    await eventStore.append(event1);
    await eventStore.append(event2);
    await eventStore.append(event3);

    const testEvents = await eventStore.getEventsByType('TestEvent');
    expect(testEvents).toHaveLength(2);
    expect(testEvents[0].eventType).toBe('TestEvent');
    expect(testEvents[1].eventType).toBe('TestEvent');

    const anotherEvents = await eventStore.getEventsByType('AnotherEvent');
    expect(anotherEvents).toHaveLength(1);
    expect(anotherEvents[0].eventType).toBe('AnotherEvent');
  });

  it('should persist events across instances', async () => {
    const event = new TestEvent('task-1', 'persistent');
    await eventStore.append(event);

    // 创建新实例
    const newStore = new JsonEventStore(testFilePath);
    const events = await newStore.getAllEvents();

    expect(events).toHaveLength(1);
    expect(events[0].aggregateId).toBe('task-1');
  });
});
