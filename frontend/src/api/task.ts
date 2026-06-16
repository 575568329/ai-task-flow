// frontend/src/api/task.ts
import type {
  TaskDTO,
  CreateTaskRequest,
  UpdateTaskRequest,
  ApproveTaskRequest,
  RejectTaskRequest,
  TaskDiffResponse,
  DispatchTaskResponse,
} from '@ai-task-flow/shared';
import { http } from './http';

export const taskApi = {
  getAll: () => http.get<TaskDTO[]>('/tasks'),
  getById: (id: string) => http.get<TaskDTO>(`/tasks/${id}`),
  create: (data: CreateTaskRequest) => http.post<TaskDTO>('/tasks', data),
  update: (id: string, data: UpdateTaskRequest) => http.patch<TaskDTO>(`/tasks/${id}`, data),
  remove: (id: string) => http.delete<void>(`/tasks/${id}`),
  /** 静默更新(拖拽乐观更新用,失败由调用方回滚) */
  updateSilent: (id: string, data: UpdateTaskRequest) =>
    http.patch<TaskDTO>(`/tasks/${id}`, data, true),
  /** 派发任务（创建 worktree，返回任务 + Claude 指令） */
  dispatch: (id: string) => http.post<DispatchTaskResponse>(`/tasks/${id}/dispatch`, {}),
  getDiff: (id: string, base?: string) =>
    http.get<TaskDiffResponse>(`/tasks/${id}/diff${base ? `?base=${base}` : ''}`),
  approve: (id: string, data: ApproveTaskRequest = {}) =>
    http.post<TaskDTO>(`/tasks/${id}/approve`, data),
  reject: (id: string, data: RejectTaskRequest) =>
    http.post<TaskDTO>(`/tasks/${id}/reject`, data),
  /** 获取任务转换好的 Markdown 文本(后端 buildTaskMarkdown 生成) */
  getMarkdown: (id: string) =>
    http.get<{ markdown: string }>(`/tasks/${id}/markdown`),
};

export const systemApi = {
  /** 打开系统文件夹选择器 */
  selectDirectory: () => http.post<{ path: string | null }>('/system/select-directory', {}),
};
