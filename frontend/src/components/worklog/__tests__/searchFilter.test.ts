// frontend/src/components/worklog/__tests__/searchFilter.test.ts
// 搜索过滤纯函数测试:关键字命中语义(与后端 query_work 一致)/全局搜索忽略树选择/组合场景。
import { describe, it, expect } from 'vitest';
import { filterEntries, matchesKeyword } from '../searchFilter';
import type { WorklogData, WorklogEntry } from '@ai-task-flow/shared';

function entry(over: Partial<WorklogEntry>): WorklogEntry {
  return {
    id: 'e_1', title: '标题', detail: '详情', date: '2026-11-18',
    createdAt: 1, updatedAt: 1, ...over,
  };
}

const data: WorklogData = {
  projects: [
    {
      id: 'p_1', name: '搜题平台', createdAt: 1,
      versions: [
        { name: 'V8.0.5', createdAt: 1, entries: [
          entry({ id: 'e_a', title: '澳门试题管理页与检索域切换', detail: '字典域切换改造', files: [{ path: 'src/exam/SearchPanel.vue' }], createdAt: 3, stage: 'dev' }),
          entry({ id: 'e_b', title: '相似题接题库引擎', detail: 'SimilarQuestionFacade 接入' }),
        ] },
        { name: 'V8.0.6', createdAt: 2, entries: [
          entry({ id: 'e_c', title: 'AI 搜题显式排序生效', detail: '两道重排守卫', createdAt: 5, stage: 'review' }),
        ] },
      ],
    },
    {
      id: 'p_2', name: 'ai-task-flow', createdAt: 3,
      versions: [
        { name: 'v0.1.0', createdAt: 3, entries: [
          entry({ id: 'e_d', title: '修复白屏 bug', detail: 'ENOENT 容错', createdAt: 9 }),
        ] },
      ],
    },
  ],
};

describe('matchesKeyword', () => {
  it('should match title case-insensitively', () => {
    expect(matchesKeyword(entry({ title: 'AI 搜题排序' }), 'ai')).toBe(true);
    expect(matchesKeyword(entry({ title: '排序' }), 'AI')).toBe(false);
  });

  it('should match detail and files.path', () => {
    expect(matchesKeyword(entry({ detail: 'SimilarQuestionFacade 接入' }), 'facade')).toBe(true);
    expect(matchesKeyword(entry({ files: [{ path: 'src/exam/SearchPanel.vue' }] }), 'searchpanel')).toBe(true);
  });

  it('should treat blank keyword as match-all', () => {
    expect(matchesKeyword(entry({}), '  ')).toBe(true);
  });
});

describe('filterEntries', () => {
  it('should filter by tree selection when not searching', () => {
    const { entries } = filterEntries(data, { project: '搜题平台', version: 'V8.0.5' }, '');
    // e_a(createdAt 3) 新于 e_b(1),新在前
    expect(entries.map((e) => e.entry.id)).toEqual(['e_a', 'e_b']);
  });

  it('should search globally ignoring selection when keyword present', () => {
    const { entries, isSearching } = filterEntries(data, { project: '搜题平台', version: 'V8.0.5' }, '排序');
    expect(isSearching).toBe(true);
    expect(entries.map((e) => e.entry.id)).toEqual(['e_c']); // 命中跨版本,树选择被忽略
  });

  it('should search across projects with context info', () => {
    const { entries } = filterEntries(data, {}, '切换');
    expect(entries).toHaveLength(1);
    expect(entries[0].project).toBe('搜题平台');
    expect(entries[0].version).toBe('V8.0.5');
  });

  it('should not load all entries when no selection and no keyword', () => {
    expect(filterEntries(data, {}, '').entries).toEqual([]);
  });

  it('should sort newest first within a project', () => {
    const { entries } = filterEntries(data, { project: '搜题平台' }, '');
    expect(entries.map((e) => e.entry.id)).toEqual(['e_c', 'e_a', 'e_b']);
  });

  it('should filter by multiple stages and unset stage', () => {
    expect(filterEntries(data, { project: '搜题平台' }, '', ['dev']).entries.map((e) => e.entry.id))
      .toEqual(['e_a']);
    expect(filterEntries(data, { project: '搜题平台' }, '', ['review']).entries.map((e) => e.entry.id))
      .toEqual(['e_c']);
    expect(filterEntries(data, { project: '搜题平台' }, '', ['unset']).entries.map((e) => e.entry.id))
      .toEqual(['e_b']);
    // 多选:dev + review 一起命中,顺序仍按新在前
    expect(filterEntries(data, { project: '搜题平台' }, '', ['dev', 'review']).entries.map((e) => e.entry.id))
      .toEqual(['e_c', 'e_a']);
    // 空数组 = 不过滤
    expect(filterEntries(data, { project: '搜题平台' }, '', []).entries).toHaveLength(3);
  });

  it('should filter by related project', () => {
    const relatedData: WorklogData = {
      projects: [{
        id: 'p_a', name: 'A', createdAt: 1,
        versions: [{
          name: 'V1', createdAt: 1,
          entries: [
            entry({ id: 'e1', title: '跨项目改动', detail: 'd', createdAt: 2, relatedProjects: ['题库'] }),
            entry({ id: 'e2', title: '普通改动', detail: 'd', createdAt: 1 }),
          ],
        }],
      }],
    };
    expect(filterEntries(relatedData, { project: 'A' }, '', [], '题库').entries.map((e) => e.entry.id))
      .toEqual(['e1']);
    expect(filterEntries(relatedData, { project: 'A' }, '', [], '题库2').entries).toHaveLength(0);
    // 不传关联项目 = 不过滤
    expect(filterEntries(relatedData, { project: 'A' }, '', []).entries).toHaveLength(2);
    // 仅关联筛选(无树选择/无关键字)也加载:树节点「另有 N 条关联记录」点击后全局列出
    expect(filterEntries(relatedData, {}, '', [], '题库').entries.map((e) => e.entry.id)).toEqual(['e1']);
    // 关联筛选与关键字可叠加
    expect(filterEntries(relatedData, { project: 'A' }, '普通', [], '题库').entries).toHaveLength(0);
  });

  it('should return empty with friendly flag when nothing matches', () => {
    const { entries, isSearching } = filterEntries(data, {}, '不存在的关键字xyz');
    expect(isSearching).toBe(true);
    expect(entries).toHaveLength(0);
  });
});
