// backend/src/domain/worklog/WorklogProgramTree.ts
// 建设主题(顶层)相关的纯函数:查询主题、校验主题名唯一、列出主题下版本。
// 不做 IO,调用方负责传入已加载的 WorklogData。
import type { WorklogData, WorklogProgram, WorklogVersion } from '@ai-task-flow/shared';
import { WorklogConflictError } from './errors.js';

/** 按 id 查找建设主题;数据缺失 programs 字段(旧数据)时视为空 */
export function findProgram(data: WorklogData, programId: string): WorklogProgram | undefined {
  return data.programs?.find((p) => p.id === programId);
}

/**
 * 校验主题名全局唯一。exceptId 用于更新场景:自身名称不算冲突。
 * 名称冲突抛 WorklogConflictError,由 HTTP/MCP 层映射为 409。
 */
export function assertProgramNameFree(data: WorklogData, name: string, exceptId?: string): void {
  if ((data.programs ?? []).some((p) => p.name === name && p.id !== exceptId)) {
    throw new WorklogConflictError(`主题名 "${name}" 已存在`);
  }
}

/** 列出归属某主题的全部版本(保持 versions 数组原顺序;旧数据缺 versions 时视为空) */
export function versionsOfProgram(data: WorklogData, programId: string): WorklogVersion[] {
  return (data.versions ?? []).filter((v) => v.programId === programId);
}
