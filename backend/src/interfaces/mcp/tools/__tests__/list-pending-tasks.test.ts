// backend/src/interfaces/mcp/tools/__tests__/list-pending-tasks.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { JsonTaskRepository } from '../../../../infrastructure/persistence/JsonTaskRepository.js';
import { Task } from '../../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../../domain/workflow/value-objects/Priority.js';
import path from 'path';
import os from 'os';

describe('list_pending_tasks MCP tool', () => {
  let repository: JsonTaskRepository;

  beforeEach(() => {
    const testPath = path.join(os.tmpdir(), `test-mcp-${Date.now()}.json`);
    repository = new JsonTaskRepository(testPath);
  });

  it('should list TODO tasks by default', async () => {
    const task1 = new Task(
      TaskId.create('WS', 1), 'Fix bug', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    const task2 = new Task(
      TaskId.create('WS', 2), 'Add feature', 'Description',
      TaskStatus.DONE, Priority.P1, undefined, undefined, [], [],
    );

    await repository.save(task1);
    await repository.save(task2);

    const todoTasks = await repository.findByStatus(TaskStatus.TODO);
    expect(todoTasks).toHaveLength(1);
    expect(todoTasks[0].title).toBe('Fix bug');
  });

  it('should list all tasks via findAll (含已完成/已阻塞)', async () => {
    const todo = new Task(
      TaskId.create('WS', 3), 't1', 'd',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
    );
    const done = new Task(
      TaskId.create('WS', 4), 't2', 'd',
      TaskStatus.DONE, Priority.P1, undefined, undefined, [], [],
    );

    await repository.save(todo);
    await repository.save(done);

    const all = await repository.findAll();
    expect(all).toHaveLength(2);
  });
});
