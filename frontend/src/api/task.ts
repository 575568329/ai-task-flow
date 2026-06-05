// frontend/src/api/task.ts
import http from './http';
import type { Task, CreateTaskRequest, UpdateTaskRequest, TaskStatus } from '@/types/task';

export const taskApi = {
  /**
   * 获取所有任务
   */
  async getAll(): Promise<Task[]> {
    const response = await http.get<Task[]>('/tasks');
    return response.data;
  },

  /**
   * 根据 ID 获取任务
   */
  async getById(id: string): Promise<Task> {
    const response = await http.get<Task>(`/tasks/${id}`);
    return response.data;
  },

  /**
   * 按状态查询任务
   */
  async getByStatus(status: TaskStatus): Promise<Task[]> {
    const response = await http.get<Task[]>(`/tasks/status/${status}`);
    return response.data;
  },

  /**
   * 创建任务
   */
  async create(data: CreateTaskRequest): Promise<Task> {
    const response = await http.post<Task>('/tasks', data);
    return response.data;
  },

  /**
   * 更新任务
   */
  async update(id: string, data: UpdateTaskRequest): Promise<Task> {
    const response = await http.patch<Task>(`/tasks/${id}`, data);
    return response.data;
  },

  /**
   * 删除任务
   */
  async delete(id: string): Promise<void> {
    await http.delete(`/tasks/${id}`);
  },
};
