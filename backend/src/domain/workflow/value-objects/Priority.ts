// backend/src/domain/workflow/value-objects/Priority.ts
export enum Priority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
}

export function priorityWeight(p: Priority): number {
  return { [Priority.P0]: 3, [Priority.P1]: 2, [Priority.P2]: 1 }[p];
}
