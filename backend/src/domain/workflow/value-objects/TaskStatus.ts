// backend/src/domain/workflow/value-objects/TaskStatus.ts
export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  // 四态状态机:TODO → IN_PROGRESS(开始做/有步骤完成)→ DONE(全步骤完成);
  // 任何态可转 BLOCKED;BLOCKED 可回 TODO/IN_PROGRESS/DONE;DONE 可回 TODO(拖回待办重开)。
  // 步骤完成度由 Task.setStepCompleted 自动推进状态,Claude 每完成一步回写即推进。
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.TODO]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.BLOCKED],
    [TaskStatus.IN_PROGRESS]: [TaskStatus.DONE, TaskStatus.BLOCKED, TaskStatus.TODO],
    [TaskStatus.DONE]: [TaskStatus.TODO, TaskStatus.BLOCKED],
    [TaskStatus.BLOCKED]: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE],
  };
  return validTransitions[from].includes(to);
}
