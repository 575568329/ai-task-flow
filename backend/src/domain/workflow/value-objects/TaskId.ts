// backend/src/domain/workflow/value-objects/TaskId.ts
export class TaskId {
  private constructor(public readonly value: string) {
    if (!/^[A-Z]+-\d+$/.test(value)) {
      throw new Error(`Invalid TaskId format: ${value}`);
    }
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
