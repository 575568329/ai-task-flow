// backend/src/domain/workflow/entities/Task.ts
import { TaskId } from '../value-objects/TaskId.js';
import { TaskStatus, isValidTransition } from '../value-objects/TaskStatus.js';
import { Priority } from '../value-objects/Priority.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';
import { TaskUpdated } from '../events/TaskUpdated.js';
import { DomainEvent } from '../../_shared/DomainEvent.js';
import type { TaskStep, TaskSource } from '@ai-task-flow/shared';

export class Task {
  private _domainEvents: DomainEvent[] = [];

  constructor(
    public readonly id: TaskId,
    public title: string,
    public description: string,
    public status: TaskStatus,
    public priority: Priority,
    public repoPath: string | undefined,
    public projectName: string | undefined,
    public relatedFiles: string[],
    public steps: TaskStep[],
    public worktree?: WorktreeRef,
    public executionResult?: ExecutionResult,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
    public source: TaskSource = 'manual',
    public sourceUrl?: string,
    public env?: 'cmd' | 'wsl' | 'pwsh',
  ) {}

  get domainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearEvents(): void {
    this._domainEvents = [];
  }

  /**
   * 记录执行结果并推进状态(由 Claude Code 通过 MCP record_result 调用)。
   *
   * 会话化改造后:打开终端不再改状态(任务停在 TODO),也不再走派发→审核两段式,
   * 故去掉「必须 DISPATCHED」校验,TODO 也能直接回写结果。
   * - status==='blocked' → BLOCKED;否则(done/partial) → DONE。
   * - 复用 TaskUpdated 事件驱动前端 SSE 刷新(不再有 TaskResultRecorded 专用事件)。
   * - worktree 字段(若存在)保留不动:它已降为可选关联,结果回写不清理它。
   */
  recordResult(result: ExecutionResult): void {
    const previousStatus = this.status;
    this.executionResult = result;
    this.status = result.status === 'blocked' ? TaskStatus.BLOCKED : TaskStatus.DONE;
    // done/partial → 兜底全勾步骤:任务整体完成,步骤自然全完成,避免卡片进度停在 0/N
    if (this.status === TaskStatus.DONE) {
      this.markAllStepsCompleted();
    }
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskUpdated(this.id.value, previousStatus, this.status));
  }

  /** 把所有步骤标记完成(任务进入完成态时兜底调用,空步骤无操作) */
  private markAllStepsCompleted(): void {
    if (this.steps.length === 0) return;
    this.steps = this.steps.map((s) => ({ ...s, completed: true }));
  }

  /**
   * 状态流转(带状态机校验 + 副作用)。
   * 供拖拽改状态等场景复用:拖到「已完成」列 → 自动全勾步骤(任务完成则步骤全完成)。
   * 非法流转抛异常,由调用方(PATCH 路由)转 400。
   */
  transitionTo(newStatus: TaskStatus): void {
    if (newStatus === this.status) return;
    if (!isValidTransition(this.status, newStatus)) {
      throw new Error(`非法状态流转: ${this.status} → ${newStatus}`);
    }
    const previousStatus = this.status;
    this.status = newStatus;
    if (newStatus === TaskStatus.DONE) {
      this.markAllStepsCompleted();
    }
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskUpdated(this.id.value, previousStatus, this.status));
  }

  /**
   * 标记单步完成状态,并按步骤完成度自动推进任务状态。
   * 供 MCP complete_step 调用:Claude 每完成一步回写。
   * - 全部步骤完成 → DONE
   * - 有完成但未全完成 → IN_PROGRESS(仅当当前为 TODO,避免从 BLOCKED/DONE 误抽出)
   * - 撤销单步完成不回退状态(避免进度抖动;如需回退用 transitionTo)
   */
  setStepCompleted(stepIndex: number, completed: boolean): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) {
      throw new Error(
        `步骤下标越界: ${stepIndex}(任务 ${this.id.value} 共 ${this.steps.length} 步)`,
      );
    }
    const previousStatus = this.status;
    this.steps = this.steps.map((s, i) => (i === stepIndex ? { ...s, completed } : s));

    const allDone = this.steps.length > 0 && this.steps.every((s) => s.completed);
    if (allDone) {
      this.status = TaskStatus.DONE;
    } else if (completed && this.status === TaskStatus.TODO) {
      this.status = TaskStatus.IN_PROGRESS;
    }
    if (this.status !== previousStatus) {
      this.updatedAt = new Date();
    }
    // 步骤完成度变了也要通知前端刷新进度,即使任务状态未变
    this._domainEvents.push(new TaskUpdated(this.id.value, previousStatus, this.status));
  }

  /**
   * 通用字段更新（供 HTTP PATCH 等场景使用）
   * 修改基础字段，并在状态变化时发布 TaskUpdated 事件以驱动前端实时刷新。
   * 注意：本方法不强制状态机校验，由调用方保证语义合理；
   * 需要状态流转校验的场景请配合 isValidTransition 使用。
   */
  applyUpdate(updates: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    repoPath?: string;
    projectName?: string;
    relatedFiles?: string[];
    steps?: TaskStep[];
    source?: TaskSource;
    sourceUrl?: string;
    env?: 'cmd' | 'wsl' | 'pwsh';
  }): void {
    const previousStatus = this.status;

    if (updates.title !== undefined) this.title = updates.title;
    if (updates.description !== undefined) this.description = updates.description;
    if (updates.status !== undefined) this.status = updates.status;
    if (updates.priority !== undefined) this.priority = updates.priority;
    if (updates.repoPath !== undefined) this.repoPath = updates.repoPath;
    if (updates.projectName !== undefined) this.projectName = updates.projectName;
    if (updates.relatedFiles !== undefined) this.relatedFiles = updates.relatedFiles;
    if (updates.steps !== undefined) this.steps = updates.steps;
    if (updates.source !== undefined) this.source = updates.source;
    if (updates.sourceUrl !== undefined) this.sourceUrl = updates.sourceUrl;
    if (updates.env !== undefined) this.env = updates.env;

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
      repoPath: this.repoPath,
      projectName: this.projectName,
      source: this.source,
      sourceUrl: this.sourceUrl,
      relatedFiles: this.relatedFiles,
      steps: this.steps,
      worktree: this.worktree ? {
        path: this.worktree.path,
        branch: this.worktree.branch,
        baseCommit: this.worktree.baseCommit,
        createdAt: this.worktree.createdAt.toISOString(),
      } : undefined,
      executionResult: this.executionResult,
      env: this.env,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
