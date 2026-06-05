// backend/src/domain/_shared/DomainEvent.ts
import { nanoid } from 'nanoid';

export abstract class DomainEvent {
  public readonly eventId: string;
  public readonly occurredAt: Date;
  public readonly eventType: string;

  constructor(
    public readonly aggregateId: string,
  ) {
    this.eventId = nanoid();
    this.occurredAt = new Date();
    this.eventType = this.constructor.name;
  }
}
