// backend/src/domain/workflow/events/TaskResultRecorded.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';

export class TaskResultRecorded extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly result: ExecutionResult,
  ) {
    super(aggregateId);
  }
}
