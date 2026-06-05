// frontend/src/stores/task.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Task, CreateTaskRequest, UpdateTaskRequest } from '@/types/task';
import { TaskStatus } from '@/types/task';
import { taskApi } from '@/api/task';

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<Task[]>([]);
  const loading = ref(false);

  // 按状态分组的任务
  const tasksByStatus = computed(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      [TaskStatus.PLANNING]: [],
      [TaskStatus.TODO]: [],
      [TaskStatus.DISPATCHED]: [],
      [TaskStatus.REVIEW]: [],
      [TaskStatus.DONE]: [],
      [TaskStatus.BLOCKED]: [],
    };

    for (const task of tasks.value) {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    }

    return grouped;
  });

  /**
   * 加载所有任务
   */
  async function fetchAll() {
    loading.value = true;
    try {
      tasks.value = await taskApi.getAll();
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建任务
   */
  async function createTask(data: CreateTaskRequest): Promise<Task> {
    const task = await taskApi.create(data);
    tasks.value.push(task);
    return task;
  }

  /**
   * 更新任务
   */
  async function updateTask(id: string, data: UpdateTaskRequest): Promise<Task> {
    const updated = await taskApi.update(id, data);
    const index = tasks.value.findIndex((t) => t.id === id);
    if (index >= 0) {
      tasks.value[index] = updated;
    }
    return updated;
  }

  /**
   * 删除任务
   */
  async function deleteTask(id: string) {
    await taskApi.delete(id);
    tasks.value = tasks.value.filter((t) => t.id !== id);
  }

  /**
   * 处理 SSE 事件（实时更新）
   */
  function handleSSEEvent(eventType: string, taskData: Task) {
    if (!taskData) return;

    const index = tasks.value.findIndex((t) => t.id === taskData.id);
    if (index >= 0) {
      tasks.value[index] = taskData;
    } else {
      tasks.value.push(taskData);
    }
  }

  return {
    tasks,
    loading,
    tasksByStatus,
    fetchAll,
    createTask,
    updateTask,
    deleteTask,
    handleSSEEvent,
  };
});
