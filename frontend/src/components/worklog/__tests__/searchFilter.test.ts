// frontend/src/components/worklog/__tests__/searchFilter.test.ts
// 搜索过滤纯函数测试:关键字命中语义(与后端 query_work 一致)/版本·需求定位/全局搜索忽略树选择/组合过滤。
import { describe, it, expect } from 'vitest';
import { filterEntries, getOutsideProjects, matchesKeyword } from '../searchFilter';
import type { WorklogData, WorklogEntry } from '@ai-task-flow/shared';

function entry(over: Partial<WorklogEntry>): WorklogEntry {
  return {
    id: 'e_1', title: '标题', detail: '详情', date: '2026-11-18',
    createdAt: 1, updatedAt: 1, ...over,
  };
}

const data: WorklogData = {
  projects: [
    { id: 'p_1', name: '搜题平台', createdAt: 1 },
    { id: 'p_2', name: 'ai-task-flow', createdAt: 3 },
  ],
  versions: [
    {
      id: 'v_1', name: 'V8.0.5', createdAt: 3,
      requirements: [
        {
          id: 'r_1', title: '澳门底层数据建设', projects: ['搜题平台'], createdAt: 1,
          entries: [
            entry({ id: 'e_a', title: '澳门试题管理页与检索域切换', detail: '字典域切换改造', files: [{ path: 'src/exam/SearchPanel.vue' }], createdAt: 3, stage: 'dev', project: '搜题平台' }),
            entry({ id: 'e_b', title: '相似题接题库引擎', detail: 'SimilarQuestionFacade 接入', project: '搜题平台' }),
          ],
        },
        {
          id: 'r_2', title: 'AI 搜题排序', createdAt: 4,
          entries: [
            entry({ id: 'e_c', title: 'AI 搜题显式排序生效', detail: '两道重排守卫', createdAt: 5, stage: 'review', project: '搜题平台' }),
          ],
        },
      ],
    },
    {
      id: 'v_2', name: 'v0.1.0', createdAt: 9,
      requirements: [
        {
          id: 'r_3', title: '白屏修复', createdAt: 9,
          entries: [
            entry({ id: 'e_d', title: '修复白屏 bug', detail: 'ENOENT 容错', createdAt: 9, project: 'ai-task-flow' }),
          ],
        },
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
  it('should filter by version subtree when not searching', () => {
    const { entries } = filterEntries(data, { versionId: 'v_1' }, '');
    // 版本下全部需求条目,新在前
    expect(entries.map((e) => e.entry.id)).toEqual(['e_c', 'e_a', 'e_b']);
  });

  it('should narrow to a requirement within the version', () => {
    const { entries } = filterEntries(data, { versionId: 'v_1', requirementId: 'r_2' }, '');
    expect(entries.map((e) => e.entry.id)).toEqual(['e_c']);
  });

  it('should tag context with version and requirement names', () => {
    const { entries } = filterEntries(data, { versionId: 'v_2' }, '');
    expect(entries[0].version).toBe('v0.1.0');
    expect(entries[0].requirement).toBe('白屏修复');
  });

  it('should search globally ignoring selection when keyword present', () => {
    const { entries, isSearching } = filterEntries(data, { versionId: 'v_1', requirementId: 'r_1' }, '排序');
    expect(isSearching).toBe(true);
    expect(entries.map((e) => e.entry.id)).toEqual(['e_c']); // 命中跨需求,树选择被忽略
  });

  it('should not load all entries when no selection and no keyword', () => {
    expect(filterEntries(data, {}, '').entries).toEqual([]);
  });

  it('should filter by multiple stages and unset stage', () => {
    expect(filterEntries(data, { versionId: 'v_1' }, '', ['dev']).entries.map((e) => e.entry.id))
      .toEqual(['e_a']);
    expect(filterEntries(data, { versionId: 'v_1' }, '', ['review']).entries.map((e) => e.entry.id))
      .toEqual(['e_c']);
    expect(filterEntries(data, { versionId: 'v_1' }, '', ['unset']).entries.map((e) => e.entry.id))
      .toEqual(['e_b']);
    // 多选:dev + review 一起命中,顺序仍按新在前
    expect(filterEntries(data, { versionId: 'v_1' }, '', ['dev', 'review']).entries.map((e) => e.entry.id))
      .toEqual(['e_c', 'e_a']);
    // 空数组 = 不过滤
    expect(filterEntries(data, { versionId: 'v_1' }, '', []).entries).toHaveLength(3);
  });

  it('should filter by entry project (6th param)', () => {
    expect(filterEntries(data, { versionId: 'v_1' }, '', [], undefined, '搜题平台').entries).toHaveLength(3);
    expect(filterEntries(data, { versionId: 'v_1' }, '', [], undefined, 'ai-task-flow').entries).toHaveLength(0);
    // 项目过滤可与关键字叠加
    expect(filterEntries(data, {}, '白屏', [], undefined, 'ai-task-flow').entries.map((e) => e.entry.id))
      .toEqual(['e_d']);
  });

  it('should filter by related project', () => {
    const relatedData: WorklogData = {
      projects: [{ id: 'p_a', name: 'A', createdAt: 1 }],
      versions: [{
        id: 'v_a', name: 'V1', createdAt: 1,
        requirements: [{
          id: 'r_a', title: 'R1', createdAt: 1,
          entries: [
            entry({ id: 'e1', title: '跨项目改动', detail: 'd', createdAt: 2, relatedProjects: ['题库'] }),
            entry({ id: 'e2', title: '普通改动', detail: 'd', createdAt: 1 }),
          ],
        }],
      }],
    };
    expect(filterEntries(relatedData, { versionId: 'v_a' }, '', [], '题库').entries.map((e) => e.entry.id))
      .toEqual(['e1']);
    expect(filterEntries(relatedData, { versionId: 'v_a' }, '', [], '题库2').entries).toHaveLength(0);
    // 不传关联项目 = 不过滤
    expect(filterEntries(relatedData, { versionId: 'v_a' }, '', []).entries).toHaveLength(2);
    // 仅关联筛选(无树选择/无关键字)也加载
    expect(filterEntries(relatedData, {}, '', [], '题库').entries.map((e) => e.entry.id)).toEqual(['e1']);
    // 关联筛选与关键字可叠加
    expect(filterEntries(relatedData, { versionId: 'v_a' }, '普通', [], '题库').entries).toHaveLength(0);
  });

  it('should return empty with friendly flag when nothing matches', () => {
    const { entries, isSearching } = filterEntries(data, {}, '不存在的关键字xyz');
    expect(isSearching).toBe(true);
    expect(entries).toHaveLength(0);
  });

  it('should stack version/requirement/stage/related/project filters', () => {
    const combo: WorklogData = {
      projects: [
        { id: 'p_1', name: 'P1', createdAt: 1 },
        { id: 'p_2', name: 'P2', createdAt: 2 },
      ],
      versions: [{
        id: 'v_1', name: 'V1', createdAt: 1,
        requirements: [
          {
            id: 'r_1', title: 'R1', createdAt: 1,
            entries: [
              entry({ id: 'm1', createdAt: 3, stage: 'dev', project: 'P1', relatedProjects: ['题库'] }),
              entry({ id: 'm2', createdAt: 2, stage: 'dev', project: 'P2', relatedProjects: ['题库'] }),
              entry({ id: 'm3', createdAt: 1, stage: 'review', project: 'P1', relatedProjects: ['题库'] }),
            ],
          },
          {
            id: 'r_2', title: 'R2', createdAt: 2,
            entries: [
              entry({ id: 'm4', createdAt: 4, stage: 'dev', project: 'P1', relatedProjects: ['题库'] }),
            ],
          },
        ],
      }],
    };
    // 六参全给:版本 + 需求 + 阶段 + 关联项目 + 实际归属项目
    expect(filterEntries(combo, { versionId: 'v_1', requirementId: 'r_1' }, '', ['dev'], '题库', 'P1')
      .entries.map((e) => e.entry.id)).toEqual(['m1']);
    // 版本级 + 项目筛选跨需求;新在前
    expect(filterEntries(combo, { versionId: 'v_1' }, '', [], undefined, 'P1')
      .entries.map((e) => e.entry.id)).toEqual(['m4', 'm1', 'm3']);
    // 关键字全局搜索 + 阶段 + 项目叠加
    expect(filterEntries(combo, {}, '标题', ['dev'], undefined, 'P2')
      .entries.map((e) => e.entry.id)).toEqual(['m2']);
    // 任一条件不匹配即空
    expect(filterEntries(combo, { versionId: 'v_1' }, '', ['dev'], '不存在的关联', 'P1').entries)
      .toHaveLength(0);
  });
});

describe('getOutsideProjects', () => {
  it('should return empty when every entry project is inside the requirement scope', () => {
    expect(getOutsideProjects({
      id: 'r_1', title: 'R1', createdAt: 1, projects: ['A', 'B'],
      entries: [
        entry({ id: 'e1', project: 'A' }),
        entry({ id: 'e2', project: 'B' }),
        entry({ id: 'e3' }), // 无归属项目,不参与判断
      ],
    })).toEqual([]);
  });

  it('should return deduped, sorted projects outside the requirement scope', () => {
    expect(getOutsideProjects({
      id: 'r_1', title: 'R1', createdAt: 1, projects: ['A'],
      entries: [
        entry({ id: 'e1', project: 'A' }),
        entry({ id: 'e2', project: 'C' }),
        entry({ id: 'e3', project: 'B' }),
        entry({ id: 'e4', project: 'C' }),
      ],
    })).toEqual(['B', 'C']);
    // 需求未声明计划项目时,所有条目项目都算范围外
    expect(getOutsideProjects({
      id: 'r_2', title: 'R2', createdAt: 1,
      entries: [
        entry({ id: 'e1', project: 'B' }),
        entry({ id: 'e2', project: 'A' }),
      ],
    })).toEqual(['A', 'B']);
  });
});
