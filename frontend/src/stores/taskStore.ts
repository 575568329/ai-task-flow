// frontend/src/stores/taskStore.ts
import { create } from 'zustand';
import type { TaskDTO, TaskStatus, CreateTaskRequest, UpdateTaskRequest } from '@ai-task-flow/shared';
import { taskApi } from '@/api/task';
import type { SSEEvent } from '@/api/sse';

interface TaskState {
  tasks: TaskDTO[];
  loading: boolean;

  fetchAll: () => Promise<void>;
  create: (data: CreateTaskRequest) => Promise<TaskDTO>;
  update: (id: string, data: UpdateTaskRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 派发任务（创建 worktree） */
  dispatch: (id: string) => Promise<void>;
  /** 拖拽乐观更新:先改本地,失败回滚 */
  optimisticMove: (id: string, status: TaskStatus) => Promise<void>;
  /** 收到 SSE 事件后,重新拉取该任务最新态合并进列表 */
  applySSEEvent: (event: SSEEvent) => void;
  upsert: (task: TaskDTO) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const tasks = await taskApi.getAll();
      set({ tasks });
    } finally {
      set({ loading: false });
    }
  },

  create: async (data) => {
    const task = await taskApi.create(data);
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  update: async (id, data) => {
    const updated = await taskApi.update(id, data);
    get().upsert(updated);
  },

  remove: async (id) => {
    await taskApi.remove(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  dispatch: async (id) => {
    const updated = await taskApi.dispatch(id);
    get().upsert(updated);
  },

  optimisticMove: async (id, status) => {
    const prev = get().tasks;
    const target = prev.find((t) => t.id === id);
    if (!target || target.status === status) return;

    // 乐观:先改本地
    set({ tasks: prev.map((t) => (t.id === id ? { ...t, status } : t)) });
    try {
      const updated = await taskApi.updateSilent(id, { status });
      get().upsert(updated);
    } catch {
      // 回滚
      set({ tasks: prev });
      throw new Error('移动失败,已回滚');
    }
  },

  applySSEEvent: (event) => {
    if (!event.aggregateId) return;
    // 事件只带状态变化,重新拉取该任务的完整最新态
    taskApi
      .getById(event.aggregateId)
      .then((task) => get().upsert(task))
      .catch(() => {
        // 任务可能已被删除,从列表移除
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== event.aggregateId) }));
      });
  },

  upsert: (task) => {
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...s.tasks];
        next[idx] = task;
        return { tasks: next };
      }
      return { tasks: [...s.tasks, task] };
    });
  },
}));
