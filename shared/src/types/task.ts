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

/** 步骤内的有序内容块：文本或图片，按数组顺序渲染 */
export type StepBlock =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string };

/**
 * 任务步骤：由有序的图文块组成。
 *
 * blocks 数组的顺序即渲染顺序——编辑器里怎么排，
 * 预览和给 AI 的 Markdown 就怎么排。
 *
 * 旧字段 description/imageUrl 仅为向后兼容保留，新代码一律用 blocks。
 * 读取旧数据时通过 normalizeStep 自动转换。
 */
export interface TaskStep {
  blocks?: StepBlock[];
  completed?: boolean; // 是否已完成（用户手动标记）
  /** @deprecated 旧格式字段，仅用于兼容历史数据 */
  description?: string;
  /** @deprecated 旧格式字段，仅用于兼容历史数据 */
  imageUrl?: string;
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

/** 目录浏览器条目 */
export interface BrowseDirEntry {
  name: string;
  isGitRepo: boolean;   // 子目录下是否含 .git
}

/** GET /api/projects/browse 响应 */
export interface BrowseDirResponse {
  path: string;             // 当前完整绝对路径
  parent: string | null;    // 父目录绝对路径,到根/盘符顶时为 null
  isGitRepo: boolean;       // 当前路径本身是不是 git 仓库
  entries: BrowseDirEntry[];
  drives?: string[];        // Windows: 可用驱动器(其他平台不返回)
  home: string;             // 用户主目录(供「回到主目录」快捷入口)
}

/** GET /api/tasks/:id/markdown 响应 */
export interface TaskMarkdownResponse {
  markdown: string;  // 完整的 markdown 文本
}
