// backend/src/interfaces/mcp/tools/__tests__/get-task.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonTaskRepository } from '../../../../infrastructure/persistence/JsonTaskRepository.js';
import { Task } from '../../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../../domain/workflow/value-objects/Priority.js';
import { WorktreeRef } from '../../../../domain/workflow/value-objects/WorktreeRef.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('get_task MCP tool', () => {
  let repository: JsonTaskRepository;
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(os.tmpdir(), `test-get-task-${Date.now()}.json`);
    repository = new JsonTaskRepository(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }
  });

  it('should get task details', async () => {
    const task = new Task(
      TaskId.create('WS', 1),
      'Fix login bug',
      'Fix the authentication issue',
      TaskStatus.TODO,
      Priority.P0,
      ['backend', 'auth'],
      ['src/auth/login.ts', 'src/middleware/auth.ts'],
      ['用户可以正常登录', '错误提示清晰']
    );

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found).not.toBeNull();
    expect(found?.title).toBe('Fix login bug');
    expect(found?.acceptanceCriteria).toHaveLength(2);
    expect(found?.relatedFiles).toHaveLength(2);
  });

  it('should return null for non-existent task', async () => {
    const found = await repository.findById(TaskId.fromString('WS-999'));
    expect(found).toBeNull();
  });

  it('should include worktree info if dispatched', async () => {
    const worktree = new WorktreeRef(
      '/tmp/workspace',
      'feature/fix-bug',
      'abc123',
      new Date()
    );

    const task = new Task(
      TaskId.create('WS', 2),
      'Task with worktree',
      'Desc',
      TaskStatus.DISPATCHED,
      Priority.P1,
      [],
      [],
      [],
      worktree
    );

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.worktree).not.toBeUndefined();
    expect(found?.worktree?.branch).toBe('feature/fix-bug');
  });
});
