// backend/src/domain/workflow/repositories/TaskRepository.ts
import { Task } from '../entities/Task.js';
import { TaskId } from '../value-objects/TaskId.js';
import { TaskStatus } from '../value-objects/TaskStatus.js';

/**
 * Task 仓储接口
 */
export interface TaskRepository {
  /**
   * 保存任务（新增或更新）
   */
  save(task: Task): Promise<void>;

  /**
   * 根据 ID 查找任务
   */
  findById(id: TaskId): Promise<Task | null>;

  /**
   * 根据状态查找任务列表
   */
  findByStatus(status: TaskStatus): Promise<Task[]>;

  /**
   * 查找所有任务
   */
  findAll(): Promise<Task[]>;

  /**
   * 删除任务
   */
  delete(id: TaskId): Promise<void>;
}
