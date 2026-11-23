// backend/src/interfaces/mcp/tools/worklog/rename-version.ts
// 新模型按稳定 id 操作:版本名可改,id 不变;versionId 用 list_versions 获取。
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.rename_version.name,
  description: CATALOG.rename_version.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string' as const, description: '要重命名的版本 id(如 v_ab12cd34,先 list_versions 获取)' },
      newName: { type: 'string' as const, description: '新版本名(与既有版本重名会报错且不改动)' },
    },
    required: ['versionId', 'newName'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.renameVersion(String(args.versionId ?? ''), String(args.newName ?? ''));
    return ok(`✅ 版本已重命名为 "${String(args.newName)}"(操作前已自动快照备份)。`);
  } catch (err) {
    return fail(err);
  }
}
