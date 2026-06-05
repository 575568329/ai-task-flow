// backend/src/domain/workflow/value-objects/WorktreeRef.ts
export class WorktreeRef {
  constructor(
    public readonly path: string,
    public readonly branch: string,
    public readonly baseCommit: string,
    public readonly createdAt: Date,
  ) {}

  static create(projectPath: string, taskId: string, baseCommit: string): WorktreeRef {
    const path = `${projectPath}/.ai-workspaces/${taskId}`;
    const branch = `ai-task/${taskId}`;
    return new WorktreeRef(path, branch, baseCommit, new Date());
  }
}
