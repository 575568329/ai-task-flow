// backend/src/domain/workflow/value-objects/TaskStatus.ts
export enum TaskStatus {
  PLANNING = 'planning',
  TODO = 'todo',
  DISPATCHED = 'dispatched',
  REVIEW = 'review',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PLANNING]: [TaskStatus.TODO],
    [TaskStatus.TODO]: [TaskStatus.DISPATCHED, TaskStatus.BLOCKED],
    [TaskStatus.DISPATCHED]: [TaskStatus.REVIEW, TaskStatus.BLOCKED],
    [TaskStatus.REVIEW]: [TaskStatus.DONE, TaskStatus.TODO],
    [TaskStatus.DONE]: [],
    [TaskStatus.BLOCKED]: [TaskStatus.TODO],
  };
  return validTransitions[from].includes(to);
}
