// backend/src/domain/worklog/WorklogTree.ts
// 版本→需求→条目 树形结构的纯查找与唯一性校验函数(无 IO、无副作用)。
import type { WorklogData, WorklogVersion, WorklogRequirement, WorklogEntry } from '@ai-task-flow/shared';
import { WorklogConflictError } from './errors.js';

/** 按 id 查找版本 */
export function findVersion(data: WorklogData, versionId: string): WorklogVersion | undefined {
  return data.versions.find((v) => v.id === versionId);
}

/** 在指定版本内按 id 查找需求 */
export function findRequirement(
  version: WorklogVersion,
  requirementId: string,
): WorklogRequirement | undefined {
  return version.requirements.find((r) => r.id === requirementId);
}

/**
 * 按条目 id 反查其所在的版本与需求。
 * 条目 id 全局唯一,遍历整棵树直到命中;未命中返回 undefined。
 */
export function findEntryLocation(
  data: WorklogData,
  entryId: string,
): { version: WorklogVersion; requirement: WorklogRequirement; entry: WorklogEntry } | undefined {
  for (const version of data.versions) {
    for (const requirement of version.requirements) {
      const entry = requirement.entries.find((e) => e.id === entryId);
      if (entry) return { version, requirement, entry };
    }
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

/**
 * 校验需求标题在所属版本内唯一。exceptId 用于更新场景:排除自身。
 * 重名抛 WorklogConflictError(映射 409)。
 */
export function assertRequirementTitleFree(
  version: WorklogVersion,
  title: string,
  exceptId?: string,
): void {
  if (version.requirements.some((r) => r.title === title && r.id !== exceptId)) {
    throw new WorklogConflictError(`需求 "${title}" 在版本 ${version.name} 中已存在`);
  }
}
