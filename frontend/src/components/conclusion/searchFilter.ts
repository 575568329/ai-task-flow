import type { ConclusionSummary } from '@ai-task-flow/shared';

export type ConclusionSelection =
  | { type: 'all' }
  | { type: 'project'; project: string }
  | { type: 'personal' };

function newestFirst(a: ConclusionSummary, b: ConclusionSummary): number {
  return b.latestDate.localeCompare(a.latestDate) || b.updatedAt - a.updatedAt;
}

export function groupConclusions(cards: ConclusionSummary[]): {
  projects: Array<{ name: string; cards: ConclusionSummary[] }>;
  personal: ConclusionSummary[];
} {
  const projects = new Map<string, ConclusionSummary[]>();
  const personal: ConclusionSummary[] = [];

  for (const card of cards) {
    if (card.scope === 'personal') {
      personal.push(card);
      continue;
    }
    const name = card.project ?? '未归类';
    const list = projects.get(name) ?? [];
    list.push(card);
    projects.set(name, list);
  }

  return {
    projects: [...projects.entries()]
      .map(([name, list]) => ({ name, cards: [...list].sort(newestFirst) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    personal: [...personal].sort(newestFirst),
  };
}

export function filterConclusions(
  cards: ConclusionSummary[],
  selection: ConclusionSelection,
): ConclusionSummary[] {
  const filtered = cards.filter((card) => {
    if (selection.type === 'all') return true;
    if (selection.type === 'personal') return card.scope === 'personal';
    return card.scope === 'project' && card.project === selection.project;
  });
  return [...filtered].sort(newestFirst);
}
