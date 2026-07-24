// backend/src/infrastructure/persistence/__tests__/JsonTaskRepository.integration.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JsonTaskRepository } from '../JsonTaskRepository.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import { InMemoryEventBus } from '../../pubsub/EventBus.js';
import { JsonEventStore } from '../../pubsub/EventStore.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('JsonTaskRepository Integration (EventBus + EventStore)', () => {
  let repository: JsonTaskRepository;
  let eventBus: InMemoryEventBus;
  let eventStore: JsonEventStore;
  let testFilePath: string;
  let testEventsPath: string;

  beforeEach(() => {
    testFilePath = path.join(os.tmpdir(), `test-tasks-${Date.now()}.json`);
    testEventsPath = path.join(os.tmpdir(), `test-events-${Date.now()}.jsonl`);

    eventBus = new InMemoryEventBus();
    eventStore = new JsonEventStore(testEventsPath);
    repository = new JsonTaskRepository(testFilePath, eventBus, eventStore);
  });

  afterEach(async () => {
    try { await fs.unlink(testFilePath); } catch { /* 忽略 */ }
    try { await fs.unlink(testEventsPath); } catch { /* 忽略 */ }
  });

  it('should publish TaskUpdated to EventBus when task is saved', async () => {
    const handler = vi.fn();
    eventBus.subscribe('TaskUpdated', handler);

    const task = new Task(
      TaskId.create('WS', 1), 'Test task', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    // 会话化改造后状态/字段变更统一发 TaskUpdated(不再有 TaskDispatched/TaskResultRecorded)
    task.applyUpdate({ title: 'Updated' });

    await repository.save(task);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventType).toBe('TaskUpdated');
  });

  it('should persist TaskUpdated to EventStore when task is saved', async () => {
    const task = new Task(
      TaskId.create('WS', 2), 'Test task', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    task.applyUpdate({ title: 'Updated' });

    await repository.save(task);

    const events = await eventStore.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('TaskUpdated');
    expect(events[0].aggregateId).toBe('WS-002');
  });

  it('should clear domain events after publishing', async () => {
    const task = new Task(
      TaskId.create('WS', 3), 'Test task', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    task.applyUpdate({ title: 'Updated' });

    // 保存前有事件
    expect(task.domainEvents).toHaveLength(1);

    await repository.save(task);

    // 保存后事件被清除
    expect(task.domainEvents).toHaveLength(0);
  });

  it('should handle multiple TaskUpdated events in single save', async () => {
    const handler = vi.fn();
    eventBus.subscribeAll(handler);

    const task = new Task(
      TaskId.create('WS', 4), 'Test task', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    // 两次变更:applyUpdate + recordResult, 各发一个 TaskUpdated
    task.applyUpdate({ title: 'Updated' });
    task.recordResult({
      status: 'done',
      changedFiles: ['file.ts'],
      notes: 'Done',
    });

    await repository.save(task);

    // 验证两个 TaskUpdated 事件都被发布
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].eventType).toBe('TaskUpdated');
    expect(handler.mock.calls[1][0].eventType).toBe('TaskUpdated');

    // 验证两个事件都被持久化
    const events = await eventStore.getAllEvents();
    expect(events).toHaveLength(2);
  });
});
