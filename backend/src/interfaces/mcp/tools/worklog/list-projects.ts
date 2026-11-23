// backend/src/interfaces/mcp/tools/worklog/list-projects.ts
// 新模型:项目降为字典(条目属性 + 路径归属),不再承载版本树。
// 输出只给 id、名称、路径尾段(隐私红线)与关联条目数;版本/需求请用 list_versions / list_requirements。
import type { WorklogData, WorklogProject } from '@ai-task-flow/shared';
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
  if (!p) return '未绑定路径';
  const segments = p.split(/[\\/]+/).filter(Boolean);
  // ≤2 段(如 D:\Study、/home/x)取末两段仍是完整绝对路径,必须进一步掩到只剩最后一段
  if (segments.length <= 2) {
    return `…${p.includes('\\') ? '\\' : '/'}${segments[segments.length - 1] ?? ''}`;
  }
  return `…${segments.slice(-2).join('\\')}`;
}

/** 统计归属于该项目的条目数:id 优先,迁移前无 id 的旧数据按名称兜底 */
function countEntries(data: WorklogData, project: WorklogProject): number {
  let count = 0;
  for (const version of data.versions) {
    for (const requirement of version.requirements) {
      for (const entry of requirement.entries) {
        if (entry.projectId === project.id) count++;
        else if (!entry.projectId && entry.project === project.name) count++;
      }
    }
  }
  return count;
}

export async function handle(_args: Record<string, unknown> | undefined, deps: ToolDeps) {
  try {
    // getTree 带项目 id/paths;listProjects 汇总不含身份信息,无法满足「id + 路径尾段」展示
    const data = await deps.worklogService.getTree();
    const projects = data.projects;
    if (projects.length === 0) {
      return ok('项目字典为空。可在页面创建项目并绑定路径(本工具只读)。');
    }

    const lines = projects.map((p) => {
      const paths = p.paths?.length ? p.paths.map((x) => pathTail(x)).join(', ') : pathTail(undefined);
      return `- ${p.name} (${p.id ?? '未迁移'}) · 路径: ${paths} · 条目 ${countEntries(data, p)}`;
    });
    return ok([
      `项目字典(共 ${projects.length} 个):`,
      '',
      ...lines,
      '',
      '版本/需求请用 list_versions / list_requirements 获取 id;记录时请使用上述已有名称(精确匹配)。',
      'ID 与路径绑定请在页面操作(本工具只读,不修改绑定)。',
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
