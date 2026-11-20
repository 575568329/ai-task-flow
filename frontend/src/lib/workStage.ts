import { WORK_STAGE_LABELS, type WorkStage } from '@ai-task-flow/shared';

/** 筛选维度里的「未标注」伪值:旧记录没有 stage */
export const UNSET_STAGE = 'unset' as const;

export type StageFilterItem = WorkStage | typeof UNSET_STAGE;

/** 多选阶段筛选:空数组 = 全部(不做阶段过滤) */
export type StageFilter = StageFilterItem[];

/** 阶段筛选项的展示文案 */
export function stageFilterLabel(value: string): string {
  if (value === UNSET_STAGE) return '未标注';
  return WORK_STAGE_LABELS[value as WorkStage] ?? value;
}

/** 单条记录是否命中多选筛选 */
export function matchStageFilter(stage: WorkStage | undefined, filter: StageFilter): boolean {
  if (filter.length === 0) return true;
  return filter.includes(stage ?? UNSET_STAGE);
}

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
