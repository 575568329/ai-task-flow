// 类型级 smoke 测试:锁定「版本 → 条目」扁平形态,防止字段名回退
import { describe, it, expect } from 'vitest';
import type { WorklogData, WorklogVersion } from '@ai-task-flow/shared';

describe('worklog types', () => {
  it('supports version → entry flat shape', () => {
    const data: WorklogData = {
      projects: [{ id: 'p_1', name: 'A', createdAt: 1 }],
      programs: [{ id: 'g_1', name: '澳门底层数据建设', createdAt: 1 }],
      versions: [{
        id: 'v_1', name: 'V8.0.8', programId: 'g_1', createdAt: 1,
        entries: [{
          id: 'e_1', title: 't', detail: 'd', date: '2026-11-23',
          createdAt: 1, updatedAt: 1, project: 'A', projectId: 'p_1',
        }],
      }],
    };
    const version: WorklogVersion = data.versions[0];
    expect(version.entries[0].projectId).toBe('p_1');
  });
});
