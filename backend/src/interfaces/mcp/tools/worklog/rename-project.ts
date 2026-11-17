// backend/src/interfaces/mcp/tools/worklog/rename-project.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.rename_project.name,
  description: CATALOG.rename_project.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: { type: 'string' as const, description: '当前项目名' },
      newName: { type: 'string' as const, description: '新项目名(与既有项目重名会报错且不改动)' },
    },
    required: ['project', 'newName'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.renameProject(String(args.project ?? ''), String(args.newName ?? ''));
    return ok(`✅ 项目已重命名为 "${String(args.newName)}"(操作前已自动快照备份)。`);
  } catch (err) {
    return fail(err);
  }
}
