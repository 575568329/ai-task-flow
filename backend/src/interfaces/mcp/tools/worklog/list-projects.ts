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

/** 路径尾段(隐私红线:不得输出完整绝对路径),如 D:\xunfei\资源加工平台 → …xunfei\资源加工平台 */
function pathTail(p?: string): string {
  return p ? `…${p.split(/[\\/]/).slice(-2).join('\\')}` : '未绑定路径';
}

export async function handle(_args: Record<string, unknown> | undefined, deps: ToolDeps) {
  try {
    // getTree 带项目 id/paths;listProjects 汇总不含身份信息,无法满足「id + 路径尾段」展示
    const projects = (await deps.worklogService.getTree()).projects;
    if (projects.length === 0) return ok('工作记录为空。首次 record_work 会自动创建项目与版本。');

    const lines = projects.map((p) => {
      const paths = p.paths?.length ? p.paths.map((x) => pathTail(x)).join(', ') : pathTail(undefined);
      const versions = p.versions
        .map((v) => {
          const dates = v.entries.map((e) => e.date).sort();
          const first = dates[0] ?? '?';
          const last = dates[dates.length - 1] ?? '?';
          return `  - ${v.name}(${v.entries.length} 条,${first} ~ ${last})`;
        })
        .join('\n');
      return `- ${p.name} (${p.id ?? '未迁移'}) (${paths})\n${versions}`;
    });
    return ok(`项目/版本树:\n\n${lines.join('\n')}\n\n记录时请使用上述已有名称(精确匹配),避免拼写变体裂树。`
      + '\n路径绑定请在页面操作(本工具只读,不修改绑定)。');
  } catch (err) {
    return fail(err);
  }
}
