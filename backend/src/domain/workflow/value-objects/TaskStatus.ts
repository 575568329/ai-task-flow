// backend/src/domain/workflow/value-objects/TaskStatus.ts
export enum TaskStatus {
  TODO = 'todo',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  // 会话化改造后状态机收敛为三态:打开终端不改状态(打开 ≠ 进行中, 无可靠触发点),
  // 只有 Claude Code 通过 MCP record_result 回写结果才推进生命周期。
  // 详见 docs/20260722172646_任务会话化改造设计方案.md §2.3 D1。
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.TODO]: [TaskStatus.DONE, TaskStatus.BLOCKED],
    [TaskStatus.DONE]: [],
    [TaskStatus.BLOCKED]: [TaskStatus.TODO],
  };
  return validTransitions[from].includes(to);
}
