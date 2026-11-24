// backend/src/domain/worklog/WorklogTree.ts
// 主题→版本→条目 树形结构的纯查找与唯一性校验函数(无 IO、无副作用)。
// 版本直接持有条目(需求层已移除)。
import type { WorklogData, WorklogVersion, WorklogEntry } from '@ai-task-flow/shared';
import { WorklogConflictError } from './errors.js';

/** 按 id 查找版本 */
export function findVersion(data: WorklogData, versionId: string): WorklogVersion | undefined {
  return data.versions.find((v) => v.id === versionId);
}

/**
 * 按条目 id 反查其所在的版本。
 * 条目 id 全局唯一,遍历整棵树直到命中;未命中返回 undefined。
 */
export function findEntryLocation(
  data: WorklogData,
  entryId: string,
): { version: WorklogVersion; entry: WorklogEntry } | undefined {
  for (const version of data.versions) {
    const entry = (version.entries ?? []).find((e) => e.id === entryId);
    if (entry) return { version, entry };
  }
  return undefined;
}

/**
 * 校验版本名在全库唯一。exceptId 用于更新场景:排除自身,允许保持原名。
 * 重名抛 WorklogConflictError(映射 409)。
 */
export function assertVersionNameFree(data: WorklogData, name: string, exceptId?: string): void {
  if (data.versions.some((v) => v.name === name && v.id !== exceptId)) {
    throw new WorklogConflictError(`版本名 "${name}" 已存在`);
  }
}
