// frontend/src/types/task.ts

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

export interface WorktreeRef {
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
}

export interface ExecutionResult {
  status: 'done' | 'partial' | 'blocked';
  changedFiles: string[];
  notes: string;
  reviewPoints?: string[];
  blockedReason?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  projects: string[];
  relatedFiles: string[];
  acceptanceCriteria: string[];
  worktree?: WorktreeRef;
  executionResult?: ExecutionResult;
  createdAt: string;
  updatedAt: string;
}

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
