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

/** 任务步骤(带可选图片) */
export interface TaskStep {
  imageUrl?: string;     // 图片相对路径,如 /api/uploads/abc.png
  description: string;   // 该步骤的任务描述
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
  repoPath?: string;              // 本地仓库路径
  projectName?: string;           // 项目名(从 repoPath 提取,可手动改)
  relatedFiles: string[];
  steps: TaskStep[];              // 任务步骤列表(替代 acceptanceCriteria)
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
  repoPath?: string;
  projectName?: string;
  relatedFiles?: string[];
  steps?: TaskStep[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  repoPath?: string;
  projectName?: string;
  relatedFiles?: string[];
  steps?: TaskStep[];
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

// ---- 新增接口契约 ----

/** POST /api/upload/image 响应 */
export interface UploadImageResponse {
  url: string;  // 图片访问路径,如 /api/uploads/abc.png
}

/** POST /api/projects/inspect 请求 */
export interface InspectProjectRequest {
  path: string;  // 本地仓库路径
}

/** POST /api/projects/inspect 响应 */
export interface InspectProjectResponse {
  projectName: string;  // 提取的项目名(git remote 或文件夹名)
  valid: boolean;       // 是否为有效 git 仓库
}

/** GET /api/tasks/:id/markdown 响应 */
export interface TaskMarkdownResponse {
  markdown: string;  // 完整的 markdown 文本
}
