import { describe, it, expect } from 'vitest';
import type { ConclusionSummary } from '@ai-task-flow/shared';
import {
  filterConclusions,
  filterConclusionsByRelatedProject,
  filterConclusionsByStage,
  groupConclusions,
} from '../searchFilter';

function card(over: Partial<ConclusionSummary>): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: 'p', title: 't', rev: 1,
    latestDate: '2026-11-18', latestDecisionExcerpt: 'd',
    source: { tool: 'manual' }, createdAt: 1, updatedAt: 1, ...over,
  };
}

const cards: ConclusionSummary[] = [
  card({ id: 'c_a', project: 'ai-task-flow', latestDate: '2026-11-18', updatedAt: 9, stage: 'dev' }),
  card({ id: 'c_b', project: 'ai-task-flow', latestDate: '2026-11-17', updatedAt: 1 }),
  card({ id: 'c_c', project: 'rpp', latestDate: '2026-11-16', updatedAt: 2, stage: 'review' }),
  card({ id: 'c_d', scope: 'personal', project: undefined, latestDate: '2026-11-15', updatedAt: 3 }),
];

describe('groupConclusions', () => {
  it('should group by project and personal, newest first', () => {
    const grouped = groupConclusions(cards);
    expect(grouped.projects.map((p) => p.name)).toEqual(['ai-task-flow', 'rpp']);
    expect(grouped.projects[0].cards.map((c) => c.id)).toEqual(['c_a', 'c_b']);
    expect(grouped.personal.map((c) => c.id)).toEqual(['c_d']);
  });
});

describe('filterConclusionsByRelatedProject', () => {
  const related = [
    card({ id: 'r1', relatedProjects: ['题库', '组卷'] }),
    card({ id: 'r2', relatedProjects: ['题库'] }),
    card({ id: 'r3' }),
  ];

  it('should filter by related project name snapshot and keep all when empty', () => {
    expect(filterConclusionsByRelatedProject(related, '题库').map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(filterConclusionsByRelatedProject(related, '组卷').map((c) => c.id)).toEqual(['r1']);
    expect(filterConclusionsByRelatedProject(related, '未关联')).toHaveLength(0);
    expect(filterConclusionsByRelatedProject(related, '')).toHaveLength(3);
  });
});

describe('filterConclusions', () => {
  it('should filter by project and personal', () => {
    expect(filterConclusions(cards, { type: 'project', project: 'rpp' }).map((c) => c.id))
      .toEqual(['c_c']);
    expect(filterConclusions(cards, { type: 'personal' }).map((c) => c.id))
      .toEqual(['c_d']);
    expect(filterConclusions(cards, { type: 'all' })).toHaveLength(4);
  });

  it('should filter by multiple stages and unset', () => {
    expect(filterConclusionsByStage(cards, ['dev']).map((c) => c.id)).toEqual(['c_a']);
    expect(filterConclusionsByStage(cards, ['review']).map((c) => c.id)).toEqual(['c_c']);
    expect(filterConclusionsByStage(cards, ['unset']).map((c) => c.id)).toEqual(['c_b', 'c_d']);
    // 多选:dev + review 一起命中
    expect(filterConclusionsByStage(cards, ['dev', 'review']).map((c) => c.id)).toEqual(['c_a', 'c_c']);
    // 空数组 = 全部
    expect(filterConclusionsByStage(cards, [])).toHaveLength(cards.length);
  });
});
