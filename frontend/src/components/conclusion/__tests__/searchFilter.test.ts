import { describe, it, expect } from 'vitest';
import type { ConclusionSummary } from '@ai-task-flow/shared';
import { filterConclusions, groupConclusions } from '../searchFilter';

function card(over: Partial<ConclusionSummary>): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: 'p', title: 't', rev: 1,
    latestDate: '2026-11-18', latestDecisionExcerpt: 'd',
    source: { tool: 'manual' }, createdAt: 1, updatedAt: 1, ...over,
  };
}

const cards: ConclusionSummary[] = [
  card({ id: 'c_a', project: 'ai-task-flow', latestDate: '2026-11-18', updatedAt: 9 }),
  card({ id: 'c_b', project: 'ai-task-flow', latestDate: '2026-11-17', updatedAt: 1 }),
  card({ id: 'c_c', project: 'rpp', latestDate: '2026-11-16', updatedAt: 2 }),
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

describe('filterConclusions', () => {
  it('should filter by project and personal', () => {
    expect(filterConclusions(cards, { type: 'project', project: 'rpp' }).map((c) => c.id))
      .toEqual(['c_c']);
    expect(filterConclusions(cards, { type: 'personal' }).map((c) => c.id))
      .toEqual(['c_d']);
    expect(filterConclusions(cards, { type: 'all' })).toHaveLength(4);
  });
});
