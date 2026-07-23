// backend/src/interfaces/mcp/tools/__tests__/record-result.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonTaskRepository } from '../../../../infrastructure/persistence/JsonTaskRepository.js';
import { Task } from '../../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../../domain/workflow/value-objects/Priority.js';
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
    try { await fs.unlink(testFilePath); } catch { /* 忽略 */ }
  });

  it('should record result for TODO task and move to DONE (会话化后无需派发)', async () => {
    const task = new Task(
      TaskId.create('WS', 1), 'Test task', 'Description',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );
    await repository.save(task);

    task.recordResult({
      status: 'done',
      changedFiles: ['file1.ts', 'file2.ts'],
      notes: 'Task completed successfully',
      reviewPoints: ['Check logic', 'Review tests'],
    });
    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.status).toBe(TaskStatus.DONE);
    expect(found?.executionResult?.status).toBe('done');
    expect(found?.executionResult?.changedFiles).toHaveLength(2);
    expect(found?.executionResult?.notes).toBe('Task completed successfully');
  });

  it('should record blocked result and move to BLOCKED', async () => {
    const task = new Task(
      TaskId.create('WS', 2), 'Blocked task', 'Desc',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    task.recordResult({
      status: 'blocked',
      changedFiles: [],
      notes: 'Blocked by dependency',
      blockedReason: 'Waiting for API endpoint',
    });
    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.status).toBe(TaskStatus.BLOCKED);
    expect(found?.executionResult?.status).toBe('blocked');
    expect(found?.executionResult?.blockedReason).toBe('Waiting for API endpoint');
  });
});
