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
    const project = String(args.project ?? '').trim();
    await deps.worklogService.deleteProject(project);
    // 与实现/catalog 一致:只移除字典项,历史条目保留(名称快照仍在),路径归属失效
    return ok(`✅ 已从项目字典移除「${project}」；历史条目不删除，其路径归属将失效。(删除前已自动快照备份)`);
  } catch (err) {
    return fail(err);
  }
}
