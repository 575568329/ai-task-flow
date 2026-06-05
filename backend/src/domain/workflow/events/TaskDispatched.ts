// backend/src/domain/workflow/events/TaskDispatched.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';

export class TaskDispatched extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly worktree: WorktreeRef,
  ) {
    super(aggregateId);
  }
}
