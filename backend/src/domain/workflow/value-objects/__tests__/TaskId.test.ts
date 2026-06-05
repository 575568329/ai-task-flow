// backend/src/domain/workflow/value-objects/__tests__/TaskId.test.ts
import { describe, it, expect } from 'vitest';
import { TaskId } from '../TaskId.js';

describe('TaskId', () => {
  it('should create valid task id', () => {
    const id = TaskId.create('WS', 1);
    expect(id.value).toBe('WS-001');
  });

  it('should throw on invalid format', () => {
    expect(() => TaskId.fromString('invalid')).toThrow();
  });

  it('should compare equality', () => {
    const id1 = TaskId.fromString('WS-001');
    const id2 = TaskId.fromString('WS-001');
    expect(id1.equals(id2)).toBe(true);
  });
});
