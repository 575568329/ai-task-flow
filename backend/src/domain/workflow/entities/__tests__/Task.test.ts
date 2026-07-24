// backend/src/domain/workflow/entities/__tests__/Task.test.ts
import { describe, it, expect } from 'vitest';
import { Task } from '../Task.js';
import { TaskId } from '../../value-objects/TaskId.js';
import { TaskStatus } from '../../value-objects/TaskStatus.js';
import { Priority } from '../../value-objects/Priority.js';
import { ExecutionResult } from '../../value-objects/ExecutionResult.js';

describe('Task', () => {
  it('should record done result and move to DONE (从 TODO 直接回写, 无需派发)', () => {
    const task = new Task(
      TaskId.create('WS', 1), 'Test', 'Desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
    );

    const result = new ExecutionResult('done', ['file.ts'], 'Fixed bug');
    task.recordResult(result);

    expect(task.status).toBe(TaskStatus.DONE);
    expect(task.executionResult).toBe(result);
    // 轻量化后复用 TaskUpdated 驱动 SSE(不再有 TaskResultRecorded 专用事件)
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskUpdated');
  });

  it('should record blocked result and move to BLOCKED', () => {
    const task = new Task(
      TaskId.create('WS', 2), 'Blocked', 'Desc',
      TaskStatus.TODO, Priority.P0, undefined, undefined, [], [],
    );

    task.recordResult(
      new ExecutionResult('blocked', [], 'Blocked', undefined, 'Waiting for API'),
    );

    expect(task.status).toBe(TaskStatus.BLOCKED);
    expect(task.executionResult?.blockedReason).toBe('Waiting for API');
  });

  it('partial result 也应推进到 DONE', () => {
    const task = new Task(
      TaskId.create('WS', 3), 'Partial', 'Desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
    );

    task.recordResult(new ExecutionResult('partial', ['a.ts'], '部分完成'));

    expect(task.status).toBe(TaskStatus.DONE);
  });

  it('should apply update and emit TaskUpdated event', () => {
    const task = new Task(
      TaskId.create('WS', 4), 'Original', 'Original desc',
      TaskStatus.TODO, Priority.P2, undefined, undefined, [], [],
    );

    task.applyUpdate({
      title: 'Updated',
      status: TaskStatus.DONE,
      priority: Priority.P0,
    });

    expect(task.title).toBe('Updated');
    expect(task.status).toBe(TaskStatus.DONE);
    expect(task.priority).toBe(Priority.P0);
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskUpdated');
  });

  it('should only update provided fields on applyUpdate', () => {
    const task = new Task(
      TaskId.create('WS', 5), 'Keep title', 'Keep desc',
      TaskStatus.TODO, Priority.P1, '/path/to/repo', 'project-a', [], [],
    );

    task.applyUpdate({ status: TaskStatus.BLOCKED });

    expect(task.title).toBe('Keep title');
    expect(task.description).toBe('Keep desc');
    expect(task.projectName).toBe('project-a');
    expect(task.status).toBe(TaskStatus.BLOCKED);
  });

  it('should default source to manual when not provided', () => {
    const task = new Task(
      TaskId.create('WS', 10), 't', 'd',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
    );
    expect(task.source).toBe('manual');
    expect(task.sourceUrl).toBeUndefined();
  });

  it('should persist source/sourceUrl in toJSON and applyUpdate', () => {
    const task = new Task(
      TaskId.create('WS', 11), 't', 'd',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [], [],
      undefined, undefined, new Date(), new Date(),
      'web', 'https://example.com/bug/1',
    );
    expect(task.source).toBe('web');
    expect(task.sourceUrl).toBe('https://example.com/bug/1');
    expect(task.toJSON().source).toBe('web');
    expect(task.toJSON().sourceUrl).toBe('https://example.com/bug/1');

    task.applyUpdate({ sourceUrl: 'https://example.com/bug/2' });
    expect(task.sourceUrl).toBe('https://example.com/bug/2');
  });

  it('setStepCompleted: 标记一步完成,TODO 自动推进到 IN_PROGRESS', () => {
    const task = new Task(
      TaskId.create('WS', 20), 'Steps', 'Desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [],
      [
        { blocks: [{ type: 'text', content: 'a' }], completed: false },
        { blocks: [{ type: 'text', content: 'b' }], completed: false },
      ],
    );

    task.setStepCompleted(0, true);

    expect(task.steps[0].completed).toBe(true);
    expect(task.steps[1].completed).toBe(false);
    expect(task.status).toBe(TaskStatus.IN_PROGRESS);
  });

  it('setStepCompleted: 全部步骤完成 → DONE', () => {
    const task = new Task(
      TaskId.create('WS', 21), 'Steps', 'Desc',
      TaskStatus.IN_PROGRESS, Priority.P1, undefined, undefined, [],
      [
        { blocks: [{ type: 'text', content: 'a' }], completed: true },
        { blocks: [{ type: 'text', content: 'b' }], completed: false },
      ],
    );

    task.setStepCompleted(1, true);

    expect(task.steps.every((s) => s.completed)).toBe(true);
    expect(task.status).toBe(TaskStatus.DONE);
  });

  it('setStepCompleted: 下标越界抛错', () => {
    const task = new Task(
      TaskId.create('WS', 22), 'Steps', 'Desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [],
      [{ blocks: [{ type: 'text', content: 'a' }], completed: false }],
    );

    expect(() => task.setStepCompleted(5, true)).toThrow(/步骤下标越界/);
  });

  it('transitionTo DONE: 自动全勾步骤', () => {
    const task = new Task(
      TaskId.create('WS', 23), 'Steps', 'Desc',
      TaskStatus.TODO, Priority.P1, undefined, undefined, [],
      [
        { blocks: [{ type: 'text', content: 'a' }], completed: false },
        { blocks: [{ type: 'text', content: 'b' }], completed: false },
      ],
    );

    task.transitionTo(TaskStatus.DONE);

    expect(task.status).toBe(TaskStatus.DONE);
    expect(task.steps.every((s) => s.completed)).toBe(true);
  });

  it('transitionTo 非法流转抛错(DONE → IN_PROGRESS 不允许)', () => {
    const task = new Task(
      TaskId.create('WS', 24), 'Done', 'Desc',
      TaskStatus.DONE, Priority.P1, undefined, undefined, [], [],
    );

    expect(() => task.transitionTo(TaskStatus.IN_PROGRESS)).toThrow(/非法状态流转/);
  });

  it('recordResult done: 兜底全勾步骤(避免卡片进度停在 0/N)', () => {
    const task = new Task(
      TaskId.create('WS', 25), 'Steps', 'Desc',
      TaskStatus.IN_PROGRESS, Priority.P1, undefined, undefined, [],
      [
        { blocks: [{ type: 'text', content: 'a' }], completed: false },
        { blocks: [{ type: 'text', content: 'b' }], completed: false },
      ],
    );

    task.recordResult(new ExecutionResult('done', ['a.ts'], '完成'));

    expect(task.status).toBe(TaskStatus.DONE);
    expect(task.steps.every((s) => s.completed)).toBe(true);
  });
});
