// backend/src/interfaces/mcp/tools/worklog/list-projects.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.list_projects.name,
  description: CATALOG.list_projects.description,
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handle(_args: Record<string, unknown> | undefined, deps: ToolDeps) {
  try {
    const projects = await deps.worklogService.listProjects();
    if (projects.length === 0) return ok('工作记录为空。首次 record_work 会自动创建项目与版本。');

    const lines = projects.map((p) => {
      const versions = p.versions
        .map((v) => `  - ${v.name}(${v.entryCount} 条,${v.firstDate ?? '?'} ~ ${v.lastDate ?? '?'})`)
        .join('\n');
      return `- ${p.name}\n${versions}`;
    });
    return ok(`项目/版本树:\n\n${lines.join('\n')}\n\n记录时请使用上述已有名称(精确匹配),避免拼写变体裂树。`);
  } catch (err) {
    return fail(err);
  }
}
