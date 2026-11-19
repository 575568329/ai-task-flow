import type { WorkStage } from '@ai-task-flow/shared';

export const STAGE_BADGE_CLASS: Record<WorkStage, string> = {
  req: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  design: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  dev: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  'self-test': 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  review: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  coverage: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  release: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  retro: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
};
