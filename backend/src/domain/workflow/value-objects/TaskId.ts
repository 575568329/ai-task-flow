// backend/src/domain/workflow/value-objects/TaskId.ts
export class TaskId {
  public readonly prefix: string;
  public readonly sequence: number;

  private constructor(public readonly value: string) {
    const match = value.match(/^([A-Z]+)-(\d+)$/);
    if (!match) {
      throw new Error(`Invalid TaskId format: ${value}`);
    }
    this.prefix = match[1];
    this.sequence = parseInt(match[2], 10);
  }

  static create(prefix: string, num: number): TaskId {
    return new TaskId(`${prefix}-${num.toString().padStart(3, '0')}`);
  }

  static fromString(value: string): TaskId {
    return new TaskId(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: TaskId): boolean {
    return this.value === other.value;
  }
}
