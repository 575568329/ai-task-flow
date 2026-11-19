import { WORK_STAGE_IDS } from '@ai-task-flow/shared';

/** MCP 工具统一的唯一阶段字段 schema（单值，缺陷修改用 fix tag 不占 stage）。 */
export const STAGE_SCHEMA = {
  type: 'string' as const,
  enum: WORK_STAGE_IDS,
  description:
    '唯一阶段标签：req 获取需求 / design 设计文档与实施计划 / dev 开发 / self-test 自测 / ' +
    'review 代码评审 / coverage 覆盖度测试 / release 上线 / retro 复盘。' +
    '缺陷修改用 tags 里的 fix 表示，不占 stage。',
};
