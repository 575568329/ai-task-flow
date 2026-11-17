// backend/src/interfaces/mcp/tools/worklog/delete-version.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.delete_version.name,
  description: CATALOG.delete_version.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: { type: 'string' as const, description: '项目名' },
      version: { type: 'string' as const, description: '要删除的版本名(可删非空版本)' },
    },
    required: ['project', 'version'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.deleteVersion(String(args.project ?? ''), String(args.version ?? ''));
    return ok('✅ 已删除该版本及其全部条目(删除前已自动快照备份)。');
  } catch (err) {
    return fail(err);
  }
}
