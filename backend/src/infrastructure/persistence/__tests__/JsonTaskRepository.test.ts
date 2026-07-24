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
      undefined,
      undefined,
      [],
      // 用旧格式输入，验证读取时自动规整为 blocks（向后兼容）
      [
        { description: 'AC1' },
        { description: 'AC2' }
      ]
    );

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found).not.toBeNull();
    expect(found?.id.value).toBe('TEST-001');
    expect(found?.title).toBe('Test Task');
    expect(found?.steps).toHaveLength(2);
    // 旧格式 {description:'AC1'} 应被规整为 [{type:'text',content:'AC1'}]
    expect(found?.steps[0].blocks).toEqual([{ type: 'text', content: 'AC1' }]);
    expect(found?.steps[1].blocks).toEqual([{ type: 'text', content: 'AC2' }]);
  });

  it('should find tasks by status', async () => {
    const task1 = new Task(
      TaskId.create('TEST', 1),
      'Task 1',
      'Desc',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    const task2 = new Task(
      TaskId.create('TEST', 2),
      'Task 2',
      'Desc',
      TaskStatus.DONE,
      Priority.P1,
      undefined,
      undefined,
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
      undefined,
      undefined,
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
      undefined,
      undefined,
      [],
      []
    );

    await repository.save(task);
    await repository.delete(task.id);

    const found = await repository.findById(task.id);
    expect(found).toBeNull();
  });

  it('should round-trip source/sourceUrl and default legacy tasks to manual', async () => {
    const webTask = new Task(
      TaskId.create('TEST', 5), 'Web task', 'desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
      undefined, undefined, new Date(), new Date(),
      'web', 'https://example.com/page',
    );
    await repository.save(webTask);
    const found = await repository.findById(webTask.id);
    expect(found?.source).toBe('web');
    expect(found?.sourceUrl).toBe('https://example.com/page');
  });

  it('应将旧数据 dispatched/review 状态迁移为 todo (幂等, done 不动)', async () => {
    // 手写会话化改造前的旧格式 tasks.json: 含 dispatched 与 review 两态
    const now = new Date().toISOString();
    const legacy = [
      { id: 'TEST-1', title: 't1', description: 'd', status: 'dispatched', priority: 'P1', source: 'manual', relatedFiles: [], steps: [], createdAt: now, updatedAt: now },
      { id: 'TEST-2', title: 't2', description: 'd', status: 'review', priority: 'P1', source: 'manual', relatedFiles: [], steps: [], createdAt: now, updatedAt: now },
      { id: 'TEST-3', title: 't3', description: 'd', status: 'done', priority: 'P1', source: 'manual', relatedFiles: [], steps: [], createdAt: now, updatedAt: now },
    ];
    await fs.writeFile(testFilePath, JSON.stringify(legacy, null, 2));

    const tasks = await repository.findAll();
    expect(tasks).toHaveLength(3);
    // dispatched/review 归一为 todo;done 保持不变
    expect(tasks.find(t => t.id.value === 'TEST-1')?.status).toBe(TaskStatus.TODO);
    expect(tasks.find(t => t.id.value === 'TEST-2')?.status).toBe(TaskStatus.TODO);
    expect(tasks.find(t => t.id.value === 'TEST-3')?.status).toBe(TaskStatus.DONE);
  });
});

