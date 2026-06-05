// backend/src/domain/workflow/entities/Task.ts
import { TaskId } from '../value-objects/TaskId.js';
import { TaskStatus } from '../value-objects/TaskStatus.js';
import { Priority } from '../value-objects/Priority.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';
import { TaskDispatched } from '../events/TaskDispatched.js';
import { TaskResultRecorded } from '../events/TaskResultRecorded.js';
import { TaskUpdated } from '../events/TaskUpdated.js';
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

  /**
   * 通用字段更新（供 HTTP PATCH 等场景使用）
   * 修改基础字段，并在状态变化时发布 TaskUpdated 事件以驱动前端实时刷新。
   * 注意：本方法不强制状态机校验，由调用方保证语义合理；
   * 严格的状态流转请使用 dispatch / recordResult / approve / reject。
   */
  applyUpdate(updates: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    projects?: string[];
    relatedFiles?: string[];
    acceptanceCriteria?: string[];
  }): void {
    const previousStatus = this.status;

    if (updates.title !== undefined) this.title = updates.title;
    if (updates.description !== undefined) this.description = updates.description;
    if (updates.status !== undefined) this.status = updates.status;
    if (updates.priority !== undefined) this.priority = updates.priority;
    if (updates.projects !== undefined) this.projects = updates.projects;
    if (updates.relatedFiles !== undefined) this.relatedFiles = updates.relatedFiles;
    if (updates.acceptanceCriteria !== undefined) {
      this.acceptanceCriteria = updates.acceptanceCriteria;
    }

    this.updatedAt = new Date();
    this._domainEvents.push(
      new TaskUpdated(this.id.value, previousStatus, this.status)
    );
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
