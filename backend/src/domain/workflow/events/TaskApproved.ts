// backend/src/domain/workflow/events/TaskApproved.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';

/**
 * 任务审查通过事件
 * 当 review 状态的任务被批准(→ done)时发布,用于驱动前端 SSE 刷新
 */
export class TaskApproved extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly mergeStrategy: 'merge' | 'keep_branch',
  ) {
    super(aggregateId);
  }
}
