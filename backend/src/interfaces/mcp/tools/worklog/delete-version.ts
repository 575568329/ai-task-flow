// backend/src/interfaces/mcp/tools/worklog/delete-version.ts
// 新模型按稳定 id 操作:版本名可改,id 不变;versionId 用 list_versions 获取。
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.delete_version.name,
  description: CATALOG.delete_version.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string' as const, description: '要删除的版本 id(如 v_ab12cd34,先 list_versions 获取)' },
    },
    required: ['versionId'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.deleteVersion(String(args.versionId ?? ''));
    return ok('✅ 已删除该版本及其全部条目(删除前已自动快照备份)。');
  } catch (err) {
    return fail(err);
  }
}
