// backend/src/interfaces/mcp/tools/__tests__/record-result.test.ts
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

describe('record_result MCP tool', () => {
  let repository: JsonTaskRepository;
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(os.tmpdir(), `test-record-${Date.now()}.json`);
    repository = new JsonTaskRepository(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }
  });

  it('should record result for dispatched task', async () => {
    const worktree = new WorktreeRef(
      '/tmp/test',
      'feature/test',
      'abc123',
      new Date()
    );

    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P0,
      [],
      [],
      []
    );

    // 派发任务
    task.dispatch(worktree);
    await repository.save(task);

    // 记录结果
    const resultEvent = task.recordResult({
      status: 'done',
      changedFiles: ['file1.ts', 'file2.ts'],
      notes: 'Task completed successfully',
      reviewPoints: ['Check logic', 'Review tests'],
    });

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.status).toBe(TaskStatus.REVIEW);
    expect(found?.executionResult?.status).toBe('done');
    expect(found?.executionResult?.changedFiles).toHaveLength(2);
    expect(found?.executionResult?.notes).toBe('Task completed successfully');
  });

  it('should fail to record result for non-dispatched task', () => {
    const task = new Task(
      TaskId.create('WS', 2),
      'Not dispatched',
      'Desc',
      TaskStatus.TODO,
      Priority.P1,
      [],
      [],
      []
    );

    expect(() => {
      task.recordResult({
        status: 'done',
        changedFiles: [],
        notes: 'Should fail',
      });
    }).toThrow('Only dispatched tasks can record result');
  });

  it('should record blocked result', async () => {
    const worktree = new WorktreeRef(
      '/tmp/test',
      'feature/blocked',
      'def456',
      new Date()
    );

    const task = new Task(
      TaskId.create('WS', 3),
      'Blocked task',
      'Desc',
      TaskStatus.TODO,
      Priority.P0,
      [],
      [],
      []
    );

    task.dispatch(worktree);
    task.recordResult({
      status: 'blocked',
      changedFiles: [],
      notes: 'Blocked by dependency',
      blockedReason: 'Waiting for API endpoint',
    });

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.executionResult?.status).toBe('blocked');
    expect(found?.executionResult?.blockedReason).toBe('Waiting for API endpoint');
  });
});
