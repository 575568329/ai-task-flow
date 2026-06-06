// backend/src/domain/workflow/entities/__tests__/Task.test.ts
import { describe, it, expect } from 'vitest';
import { Task } from '../Task.js';
import { TaskId } from '../../value-objects/TaskId.js';
import { TaskStatus } from '../../value-objects/TaskStatus.js';
import { Priority } from '../../value-objects/Priority.js';
import { WorktreeRef } from '../../value-objects/WorktreeRef.js';
import { ExecutionResult } from '../../value-objects/ExecutionResult.js';

describe('Task', () => {
  it('should dispatch task and emit event', () => {
    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P1,
      undefined,
      undefined,
      [],
      []
    );

    const worktree = WorktreeRef.create('/path/to/project', 'ws-001', 'abc123');
    task.dispatch(worktree);

    expect(task.status).toBe(TaskStatus.DISPATCHED);
    expect(task.worktree).toBe(worktree);
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskDispatched');
  });

  it('should record result and move to review', () => {
    const task = new Task(
      TaskId.create('WS', 2),
      'Test',
      'Desc',
      TaskStatus.DISPATCHED,
      Priority.P0,
      undefined,
      undefined,
      [],
      []
    );

    const result = new ExecutionResult('done', ['file.ts'], 'Fixed bug');
    task.recordResult(result);

    expect(task.status).toBe(TaskStatus.REVIEW);
    expect(task.executionResult).toBe(result);
  });

  it('should reject invalid state transition', () => {
    const task = new Task(
      TaskId.create('WS', 3),
      'Test',
      'Desc',
      TaskStatus.DONE,
      Priority.P2,
      undefined,
      undefined,
      [],
      []
    );

    const worktree = WorktreeRef.create('/path', 'ws-003', 'xyz');
    expect(() => task.dispatch(worktree)).toThrow('Only TODO tasks');
  });

  it('should apply update and emit TaskUpdated event', () => {
    const task = new Task(
      TaskId.create('WS', 4),
      'Original',
      'Original desc',
      TaskStatus.TODO,
      Priority.P2,
      undefined,
      undefined,
      [],
      []
    );

    task.applyUpdate({
      title: 'Updated',
      status: TaskStatus.DISPATCHED,
      priority: Priority.P0,
    });

    expect(task.title).toBe('Updated');
    expect(task.status).toBe(TaskStatus.DISPATCHED);
    expect(task.priority).toBe(Priority.P0);
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskUpdated');
  });

  it('should only update provided fields on applyUpdate', () => {
    const task = new Task(
      TaskId.create('WS', 5),
      'Keep title',
      'Keep desc',
      TaskStatus.TODO,
      Priority.P1,
      '/path/to/repo',
      'project-a',
      [],
      []
    );

    task.applyUpdate({ status: TaskStatus.BLOCKED });

    expect(task.title).toBe('Keep title');
    expect(task.description).toBe('Keep desc');
    expect(task.projectName).toBe('project-a');
    expect(task.status).toBe(TaskStatus.BLOCKED);
  });

  it('should approve a review task and emit TaskApproved', () => {
    const task = new Task(
      TaskId.create('WS', 6),
      'Reviewable',
      'desc',
      TaskStatus.REVIEW,
      Priority.P1,
      undefined,
      undefined,
      [],
      []
    );

    task.approve('merge');

    expect(task.status).toBe(TaskStatus.DONE);
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskApproved');
  });

  it('should reject a review task and emit TaskRejected', () => {
    const task = new Task(
      TaskId.create('WS', 7),
      'Reviewable',
      'desc',
      TaskStatus.REVIEW,
      Priority.P1,
      undefined,
      undefined,
      [],
      []
    );

    task.reject('需要补测试');

    expect(task.status).toBe(TaskStatus.TODO);
    expect(task.executionResult).toBeUndefined();
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskRejected');
  });

  it('should not approve a non-review task', () => {
    const task = new Task(
      TaskId.create('WS', 8),
      't',
      'd',
      TaskStatus.TODO,
      Priority.P2,
      undefined,
      undefined,
      [],
      []
    );

    expect(() => task.approve('merge')).toThrow('Only review tasks');
  });
});
