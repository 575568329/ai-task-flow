// 工作阶段：唯一单值标签（不是多值 tags）。
// 缺陷修改不设阶段，用既有 fix tag 表示工作类型。
export const WORK_STAGES = [
  { id: 'req', label: '获取需求', order: 1 },
  { id: 'design', label: '设计文档/实施计划', order: 2 },
  { id: 'dev', label: '开发阶段', order: 3 },
  { id: 'self-test', label: '自测阶段', order: 4 },
  { id: 'review', label: '代码评审', order: 5 },
  { id: 'coverage', label: '覆盖度测试', order: 6 },
  { id: 'release', label: '上线', order: 7 },
  { id: 'retro', label: '复盘', order: 8 },
] as const;

export type WorkStage = (typeof WORK_STAGES)[number]['id'];

export const WORK_STAGE_IDS: WorkStage[] = WORK_STAGES.map((stage) => stage.id);

export const WORK_STAGE_LABELS: Record<WorkStage, string> = Object.fromEntries(
  WORK_STAGES.map((stage) => [stage.id, stage.label]),
) as Record<WorkStage, string>;

export function isWorkStage(value: unknown): value is WorkStage {
  return typeof value === 'string' && (WORK_STAGE_IDS as string[]).includes(value);
}

/** 阶段 → xkzy-harness matrix stage 0–5 的映射（仅用于流程报表，不参与唯一标签） */
export const HARNESS_STAGE_BY_WORK_STAGE: Record<WorkStage, number | 'cross-cutting'> = {
  req: 1,
  design: 2,
  dev: 4,
  'self-test': 4,
  review: 4,
  coverage: 5,
  release: 5,
  retro: 'cross-cutting',
};
