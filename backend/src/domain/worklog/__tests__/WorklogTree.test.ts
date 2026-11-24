import { describe, it, expect } from 'vitest';
import type { WorklogData } from '@ai-task-flow/shared';
import { findEntryLocation, assertVersionNameFree } from '../WorklogTree.js';

const data: WorklogData = {
  projects: [],
  programs: [{ id: 'g1', name: '测试主题', createdAt: 1 }],
  versions: [
    { id: 'v1', name: 'V8.0.8', programId: 'g1', createdAt: 1, requirements: [
      { id: 'r1', title: '需求A', createdAt: 1, entries: [
        { id: 'e1', title: 't', detail: 'd', date: 'd', createdAt: 1, updatedAt: 1 },
      ] },
    ] },
  ],
};

describe('WorklogTree', () => {
  it('finds entry with its version and requirement', () => {
    const found = findEntryLocation(data, 'e1');
    expect(found?.version.id).toBe('v1');
    expect(found?.requirement.id).toBe('r1');
  });
  it('returns undefined for unknown entry', () => {
    expect(findEntryLocation(data, 'nope')).toBeUndefined();
  });
  it('rejects duplicate version name', () => {
    expect(() => assertVersionNameFree(data, 'V8.0.8')).toThrow(/已存在/);
    expect(() => assertVersionNameFree(data, 'V8.0.8', 'v1')).not.toThrow();
  });
});
