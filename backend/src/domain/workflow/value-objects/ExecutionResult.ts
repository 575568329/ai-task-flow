// backend/src/domain/workflow/value-objects/ExecutionResult.ts
export class ExecutionResult {
  constructor(
    public readonly status: 'done' | 'partial' | 'blocked',
    public readonly changedFiles: string[],
    public readonly notes: string,
    public readonly reviewPoints?: string[],
    public readonly blockedReason?: string,
  ) {
    if (status === 'blocked' && !blockedReason) {
      throw new Error('blockedReason is required when status is blocked');
    }
  }
}
