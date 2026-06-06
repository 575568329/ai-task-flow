// backend/src/interfaces/mcp/tools/__tests__/add-note-to-task.test.ts
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

describe('add_note_to_task MCP tool', () => {
  let repository: JsonTaskRepository;
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(os.tmpdir(), `test-note-${Date.now()}.json`);
    repository = new JsonTaskRepository(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }
  });

  it('should add note to existing task', async () => {
    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Original description',
      TaskStatus.TODO,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    await repository.save(task);

    // 添加备注
    task.description = task.description + '\n\n---\n**备注**: This is a note';
    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.description).toContain('Original description');
    expect(found?.description).toContain('This is a note');
  });

  it('should fail to add note to non-existent task', async () => {
    const task = await repository.findById(TaskId.fromString('WS-999'));
    expect(task).toBeNull();
  });
});

