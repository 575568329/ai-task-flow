// backend/src/interfaces/mcp/tools/worklog/rename-version.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.rename_version.name,
  description: CATALOG.rename_version.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: { type: 'string' as const, description: '项目名' },
      version: { type: 'string' as const, description: '当前版本名' },
      newName: { type: 'string' as const, description: '新版本名(与既有版本重名会报错且不改动)' },
    },
    required: ['project', 'version', 'newName'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.renameVersion(
      String(args.project ?? ''), String(args.version ?? ''), String(args.newName ?? ''),
    );
    return ok(`✅ 版本已重命名为 "${String(args.newName)}"(操作前已自动快照备份)。`);
  } catch (err) {
    return fail(err);
  }
}
