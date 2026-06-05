// backend/src/infrastructure/persistence/__tests__/JsonTaskRepository.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonTaskRepository } from '../JsonTaskRepository.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('JsonTaskRepository', () => {
  let repository: JsonTaskRepository;
  let testFilePath: string;

  beforeEach(async () => {
    testFilePath = path.join(os.tmpdir(), `test-tasks-${Date.now()}.json`);
    repository = new JsonTaskRepository(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 文件可能不存在
    }
  });

  it('should save and find task by id', async () => {
    const task = new Task(
      TaskId.create('TEST', 1),
      'Test Task',
      'Description',
      TaskStatus.TODO,
      Priority.P1,
      ['project-a'],
      [],
      ['AC1', 'AC2']
    );

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found).not.toBeNull();
    expect(found?.id.value).toBe('TEST-001');
    expect(found?.title).toBe('Test Task');
    expect(found?.acceptanceCriteria).toEqual(['AC1', 'AC2']);
  });

  it('should find tasks by status', async () => {
    const task1 = new Task(
      TaskId.create('TEST', 1),
      'Task 1',
      'Desc',
      TaskStatus.TODO,
      Priority.P0,
      [],
      [],
      []
    );

    const task2 = new Task(
      TaskId.create('TEST', 2),
      'Task 2',
      'Desc',
      TaskStatus.DONE,
      Priority.P1,
      [],
      [],
      []
    );

    await repository.save(task1);
    await repository.save(task2);

    const todoTasks = await repository.findByStatus(TaskStatus.TODO);
    expect(todoTasks).toHaveLength(1);
    expect(todoTasks[0].id.value).toBe('TEST-001');
  });

  it('should update existing task', async () => {
    const task = new Task(
      TaskId.create('TEST', 3),
      'Original',
      'Desc',
      TaskStatus.TODO,
      Priority.P2,
      [],
      [],
      []
    );

    await repository.save(task);

    task.title = 'Updated';
    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.title).toBe('Updated');

    const allTasks = await repository.findAll();
    expect(allTasks).toHaveLength(1);
  });

  it('should delete task', async () => {
    const task = new Task(
      TaskId.create('TEST', 4),
      'To Delete',
      'Desc',
      TaskStatus.TODO,
      Priority.P1,
      [],
      [],
      []
    );

    await repository.save(task);
    await repository.delete(task.id);

    const found = await repository.findById(task.id);
    expect(found).toBeNull();
  });
});
