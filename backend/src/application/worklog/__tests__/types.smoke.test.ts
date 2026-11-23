// 类型级 smoke 测试:锁定「版本 → 需求 → 条目」形态,防止字段名回退
import { describe, it, expect } from 'vitest';
import type { WorklogData, WorklogVersion, WorklogRequirement } from '@ai-task-flow/shared';

describe('worklog types', () => {
  it('supports version → requirement → entry shape', () => {
    const data: WorklogData = {
      projects: [{ id: 'p_1', name: 'A', createdAt: 1 }],
      versions: [{
        id: 'v_1', name: 'V8.0.8', createdAt: 1,
        requirements: [{
          id: 'r_1', title: '澳门底层数据建设', createdAt: 1,
          entries: [{
            id: 'e_1', title: 't', detail: 'd', date: '2026-11-23',
            createdAt: 1, updatedAt: 1, project: 'A', projectId: 'p_1',
          }],
        }],
      }],
    };
    const version: WorklogVersion = data.versions[0];
    const requirement: WorklogRequirement = version.requirements[0];
    expect(requirement.entries[0].projectId).toBe('p_1');
  });
});
