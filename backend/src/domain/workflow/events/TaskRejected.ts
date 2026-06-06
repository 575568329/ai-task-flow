// backend/src/domain/workflow/events/TaskRejected.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';

/**
 * 任务审查打回事件
 * 当 review 状态的任务被打回(→ todo)时发布,用于驱动前端 SSE 刷新
 */
export class TaskRejected extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly reason: string,
  ) {
    super(aggregateId);
  }
}
