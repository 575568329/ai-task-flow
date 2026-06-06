// frontend/src/api/task.ts
import type {
  TaskDTO,
  CreateTaskRequest,
  UpdateTaskRequest,
  ApproveTaskRequest,
  RejectTaskRequest,
  TaskDiffResponse,
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
  /** 派发任务（创建 worktree） */
  dispatch: (id: string) => http.post<TaskDTO>(`/tasks/${id}/dispatch`, {}),
  getDiff: (id: string, base?: string) =>
    http.get<TaskDiffResponse>(`/tasks/${id}/diff${base ? `?base=${base}` : ''}`),
  approve: (id: string, data: ApproveTaskRequest = {}) =>
    http.post<TaskDTO>(`/tasks/${id}/approve`, data),
  reject: (id: string, data: RejectTaskRequest) =>
    http.post<TaskDTO>(`/tasks/${id}/reject`, data),
};
