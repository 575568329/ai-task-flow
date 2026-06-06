// shared/src/types/task.ts
// 前后端共享的任务类型定义(单一来源,避免漂移)

export enum TaskStatus {
  PLANNING = 'planning',
  TODO = 'todo',
  DISPATCHED = 'dispatched',
  REVIEW = 'review',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export enum Priority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
}

export interface WorktreeRefDTO {
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
}

export interface ExecutionResultDTO {
  status: 'done' | 'partial' | 'blocked';
  changedFiles: string[];
  notes: string;
  reviewPoints?: string[];
  blockedReason?: string;
}

/** 任务的 JSON 表示(Task.toJSON() 的产物 / HTTP 响应体) */
export interface TaskDTO {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  projects: string[];
  relatedFiles: string[];
  acceptanceCriteria: string[];
  worktree?: WorktreeRefDTO;
  executionResult?: ExecutionResultDTO;
  createdAt: string;
  updatedAt: string;
}

// ---- 请求契约 ----

export interface CreateTaskRequest {
  prefix: string;
  title: string;
  description: string;
  priority?: Priority;
  projects?: string[];
  relatedFiles?: string[];
  acceptanceCriteria?: string[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  projects?: string[];
  relatedFiles?: string[];
  acceptanceCriteria?: string[];
}

export type MergeStrategy = 'merge' | 'keep_branch';

export interface ApproveTaskRequest {
  mergeStrategy?: MergeStrategy;
}

export interface RejectTaskRequest {
  reason: string;
}

export interface TaskDiffResponse {
  taskId: string;
  branch: string;
  baseBranch: string;
  diff: string;
}
