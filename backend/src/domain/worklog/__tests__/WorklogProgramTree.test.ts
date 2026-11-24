// backend/src/domain/worklog/__tests__/WorklogProgramTree.test.ts
import { describe, it, expect } from 'vitest';
import type { WorklogData } from '@ai-task-flow/shared';
import { findProgram, assertProgramNameFree, versionsOfProgram } from '../WorklogProgramTree.js';

const data: WorklogData = {
  projects: [],
  programs: [
    { id: 'g1', name: '澳门底层数据建设', createdAt: 1 },
    { id: 'g2', name: '大陆数据建设', createdAt: 2 },
  ],
  versions: [
    { id: 'v1', name: 'V8.0.8', programId: 'g1', createdAt: 1, requirements: [] },
    { id: 'v2', name: 'V8.0.9', programId: 'g1', createdAt: 2, requirements: [] },
    { id: 'v3', name: 'V1.0.0', programId: 'g2', createdAt: 3, requirements: [] },
  ],
};

describe('WorklogProgramTree', () => {
  it('finds program by id', () => {
    expect(findProgram(data, 'g1')?.name).toBe('澳门底层数据建设');
  });
  it('lists versions of a program', () => {
    expect(versionsOfProgram(data, 'g1').map((v) => v.name)).toEqual(['V8.0.8', 'V8.0.9']);
  });
  it('rejects duplicate program name', () => {
    expect(() => assertProgramNameFree(data, '澳门底层数据建设')).toThrow(/已存在/);
    expect(() => assertProgramNameFree(data, '澳门底层数据建设', 'g1')).not.toThrow();
  });
});
