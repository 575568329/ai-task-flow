// backend/src/interfaces/mcp/tools/worklog/delete-project.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.delete_project.name,
  description: CATALOG.delete_project.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: { type: 'string' as const, description: '要删除的项目名' },
    },
    required: ['project'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.deleteProject(String(args.project ?? ''));
    return ok('✅ 已删除该项目及其全部版本与条目(删除前已自动快照备份)。');
  } catch (err) {
    return fail(err);
  }
}
