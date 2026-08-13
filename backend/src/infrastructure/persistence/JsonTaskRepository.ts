// backend/src/infrastructure/persistence/JsonTaskRepository.ts
// 并发与崩溃安全:继承 JsonRepository(withWriteLock 串行化 + tmp+rename 原子写)。
// 历史问题(已修):原 saveAll 裸 fs.writeFile,写一半崩溃损坏整个 tasks.json(全部任务丢失);
// 且 loadAll→改→saveAll 非原子,前端连发 PATCH 在 async 织入下后写覆盖前写。
// 现 save/delete 经 withWriteLock 串行化 + 原子写。
import { tasksFilePath } from '../../config/dataDir.js';
import { Task } from '../../domain/workflow/entities/Task.js';
import { TaskId } from '../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../domain/workflow/value-objects/Priority.js';
import { WorktreeRef } from '../../domain/workflow/value-objects/WorktreeRef.js';
import { ExecutionResult } from '../../domain/workflow/value-objects/ExecutionResult.js';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { EventBus } from '../pubsub/EventBus.js';
import { EventStore } from '../pubsub/EventStore.js';
import { TaskFileWatcher } from './TaskFileWatcher.js';
import type { TaskDTO } from '@ai-task-flow/shared';
import { normalizeSteps } from '@ai-task-flow/shared';
import { JsonRepository } from './JsonRepository.js';

/**
 * JSON 文件存储的 Task 仓储实现
 * 存储位置：~/.ai-task-flow/tasks.json
 */
export class JsonTaskRepository extends JsonRepository implements TaskRepository {
  constructor(
    customPath?: string,
    private eventBus?: EventBus,
    private eventStore?: EventStore,
    private watcher?: TaskFileWatcher,
  ) {
    super(customPath ?? tasksFilePath());
  }

  async save(task: Task): Promise<void> {
    // 「读-改-写」经 withWriteLock 串行化,避免并发 save 在 async 织入下后写覆盖前写
    await this.withWriteLock(async () => {
      const tasks = await this.loadAll();
      const index = tasks.findIndex(t => t.id.equals(task.id));
      if (index >= 0) tasks[index] = task;
      else tasks.push(task);
      await this.saveAll(tasks);
    });

    // 发布和持久化领域事件(锁外执行:数据已原子落盘,事件发布可与下一次写并行)
    const events = task.domainEvents;
    if (events.length > 0) {
      for (const event of events) {
        // 发布到 EventBus（如果有）
        if (this.eventBus) {
          await this.eventBus.publish(event);
        }
        // 持久化到 EventStore（如果有）
        if (this.eventStore) {
          await this.eventStore.append(event);
        }
      }
      // 清除已发布的事件
      task.clearEvents();
    }
  }

  async findById(id: TaskId): Promise<Task | null> {
    const tasks = await this.loadAll();
    return tasks.find(t => t.id.equals(id)) || null;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    const tasks = await this.loadAll();
    return tasks.filter(t => t.status === status);
  }

  async findAll(): Promise<Task[]> {
    return this.loadAll();
  }

  async delete(id: TaskId): Promise<void> {
    await this.withWriteLock(async () => {
      const tasks = await this.loadAll();
      const filtered = tasks.filter(t => !t.id.equals(id));
      await this.saveAll(filtered);
    });
  }

  private async loadAll(): Promise<Task[]> {
    const text = await this.read();
    if (text === undefined) return [];
    const data = JSON.parse(text);
    // 兼容两种格式：直接数组或包含 tasks 字段的对象
    const dtos: TaskDTO[] = Array.isArray(data) ? data : (data.tasks || []);
    return dtos.map(dto => this.dtoToEntity(dto));
  }

  private async saveAll(tasks: Task[]): Promise<void> {
    const dtos = tasks.map(t => t.toJSON());
    const raw = JSON.stringify(dtos, null, 2);
    await this.write(raw);
    // 通知文件监听器:这是本进程写入,刷新基线,避免随后轮询误判为外部变更而重复推送
    this.watcher?.markSelfWrite(raw);
  }

  private dtoToEntity(dto: TaskDTO): Task {
    // 数据迁移(幂等):会话化改造前任务可能处于 dispatched/review 两态,
    // 状态机收敛为三态后统一归一为 TODO。executionResult/worktree 原样保留
    // (后者降为可选关联,不再随派发强绑)。反复加载只归一一次——已 TODO 的不再动。
    const rawStatus = dto.status as string;
    const status: TaskStatus =
      rawStatus === 'dispatched' || rawStatus === 'review' ? TaskStatus.TODO : dto.status;

    let worktree: WorktreeRef | undefined;
    if (dto.worktree) {
      worktree = new WorktreeRef(
        dto.worktree.path,
        dto.worktree.branch,
        dto.worktree.baseCommit,
        new Date(dto.worktree.createdAt)
      );
    }

    let executionResult: ExecutionResult | undefined;
    if (dto.executionResult) {
      executionResult = new ExecutionResult(
        dto.executionResult.status,
        dto.executionResult.changedFiles,
        dto.executionResult.notes,
        dto.executionResult.reviewPoints,
        dto.executionResult.blockedReason
      );
    }

    return new Task(
      TaskId.fromString(dto.id),
      dto.title,
      dto.description,
      status,
      dto.priority,
      dto.repoPath,
      dto.projectName,
      dto.relatedFiles,
      // 读取时规整步骤：旧格式 {description,imageUrl} 自动转为 blocks
      normalizeSteps(dto.steps),
      worktree,
      executionResult,
      new Date(dto.createdAt),
      new Date(dto.updatedAt),
      dto.source ?? 'manual',   // 旧数据无 source 字段 → 视为手动
      dto.sourceUrl,
      dto.env,
    );
  }
}
