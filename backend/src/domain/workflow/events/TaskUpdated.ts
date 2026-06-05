// backend/src/domain/workflow/events/TaskUpdated.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';
import { TaskStatus } from '../value-objects/TaskStatus.js';

/**
 * 任务更新事件
 * 当任务通过通用更新（如 HTTP PATCH）修改时发布
 * 用于驱动前端 SSE 实时刷新
 */
export class TaskUpdated extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly previousStatus: TaskStatus,
    public readonly currentStatus: TaskStatus,
  ) {
    super(aggregateId);
  }
}
