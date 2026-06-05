// backend/src/domain/workflow/entities/Task.ts
import { TaskId } from '../value-objects/TaskId.js';
import { TaskStatus } from '../value-objects/TaskStatus.js';
import { Priority } from '../value-objects/Priority.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';
import { TaskDispatched } from '../events/TaskDispatched.js';
import { TaskResultRecorded } from '../events/TaskResultRecorded.js';
import { DomainEvent } from '../../_shared/DomainEvent.js';

export class Task {
  private _domainEvents: DomainEvent[] = [];

  constructor(
    public readonly id: TaskId,
    public title: string,
    public description: string,
    public status: TaskStatus,
    public priority: Priority,
    public projects: string[],
    public relatedFiles: string[],
    public acceptanceCriteria: string[],
    public worktree?: WorktreeRef,
    public executionResult?: ExecutionResult,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
  ) {}

  get domainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearEvents(): void {
    this._domainEvents = [];
  }

  dispatch(worktree: WorktreeRef): void {
    if (this.status !== TaskStatus.TODO) {
      throw new Error('Only TODO tasks can be dispatched');
    }
    this.worktree = worktree;
    this.status = TaskStatus.DISPATCHED;
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskDispatched(this.id.value, worktree));
  }

  recordResult(result: ExecutionResult): void {
    if (this.status !== TaskStatus.DISPATCHED) {
      throw new Error('Only dispatched tasks can record result');
    }
    this.executionResult = result;
    this.status = result.status === 'blocked' ? TaskStatus.BLOCKED : TaskStatus.REVIEW;
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskResultRecorded(this.id.value, result));
  }

  approve(mergeStrategy: 'merge' | 'keep_branch'): void {
    if (this.status !== TaskStatus.REVIEW) {
      throw new Error('Only review tasks can be approved');
    }
    this.status = TaskStatus.DONE;
    this.updatedAt = new Date();
    // TaskApproved event 省略，MVP 阶段简化
  }

  reject(reason: string): void {
    if (this.status !== TaskStatus.REVIEW) {
      throw new Error('Only review tasks can be rejected');
    }
    this.status = TaskStatus.TODO;
    this.worktree = undefined;
    this.executionResult = undefined;
    this.updatedAt = new Date();
    // TaskRejected event 省略
  }

  toJSON() {
    return {
      id: this.id.value,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      projects: this.projects,
      relatedFiles: this.relatedFiles,
      acceptanceCriteria: this.acceptanceCriteria,
      worktree: this.worktree ? {
        path: this.worktree.path,
        branch: this.worktree.branch,
        baseCommit: this.worktree.baseCommit,
        createdAt: this.worktree.createdAt.toISOString(),
      } : undefined,
      executionResult: this.executionResult,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
