// backend/src/infrastructure/persistence/__tests__/JsonTaskRepository.integration.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JsonTaskRepository } from '../JsonTaskRepository.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import { WorktreeRef } from '../../../domain/workflow/value-objects/WorktreeRef.js';
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
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }
    try {
      await fs.unlink(testEventsPath);
    } catch {
      // 忽略
    }
  });

  it('should publish events to EventBus when task is saved', async () => {
    const handler = vi.fn();
    eventBus.subscribe('TaskDispatched', handler);

    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    // 派发任务（生成 TaskDispatched 事件）
    const worktree = new WorktreeRef('/tmp/test', 'ai-task/WS-001', 'abc123', new Date());
    task.dispatch(worktree);

    await repository.save(task);

    // 验证事件被发布
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventType).toBe('TaskDispatched');
  });

  it('should persist events to EventStore when task is saved', async () => {
    const task = new Task(
      TaskId.create('WS', 2),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    // 派发任务
    const worktree = new WorktreeRef('/tmp/test', 'ai-task/WS-002', 'def456', new Date());
    task.dispatch(worktree);

    await repository.save(task);

    // 验证事件被持久化
    const events = await eventStore.getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('TaskDispatched');
    expect(events[0].aggregateId).toBe('WS-002');
  });

  it('should clear domain events after publishing', async () => {
    const task = new Task(
      TaskId.create('WS', 3),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    const worktree = new WorktreeRef('/tmp/test', 'ai-task/WS-003', 'ghi789', new Date());
    task.dispatch(worktree);

    // 保存前有事件
    expect(task.domainEvents).toHaveLength(1);

    await repository.save(task);

    // 保存后事件被清除
    expect(task.domainEvents).toHaveLength(0);
  });

  it('should handle multiple events in single save', async () => {
    const handler = vi.fn();
    eventBus.subscribeAll(handler);

    const task = new Task(
      TaskId.create('WS', 4),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    // 派发
    const worktree = new WorktreeRef('/tmp/test', 'ai-task/WS-004', 'jkl012', new Date());
    task.dispatch(worktree);

    // 记录结果
    task.recordResult({
      status: 'done',
      changedFiles: ['file.ts'],
      notes: 'Done',
    });

    await repository.save(task);

    // 验证两个事件都被发布
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].eventType).toBe('TaskDispatched');
    expect(handler.mock.calls[1][0].eventType).toBe('TaskResultRecorded');

    // 验证两个事件都被持久化
    const events = await eventStore.getAllEvents();
    expect(events).toHaveLength(2);
  });
});
