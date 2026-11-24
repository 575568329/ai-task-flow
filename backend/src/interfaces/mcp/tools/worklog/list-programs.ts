// backend/src/interfaces/mcp/tools/worklog/list-programs.ts
// 只读:让 AI 拿到 programId 与主题规模(主题只能由用户在页面创建,AI 不得创建或猜名称)。
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.list_programs.name,
  description: CATALOG.list_programs.description,
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handle(_args: Record<string, unknown> | undefined, deps: ToolDeps) {
  try {
    const programs = await deps.worklogService.listPrograms();
    if (programs.length === 0) {
      return ok('暂无建设主题（请在页面新建）。');
    }

    const lines = programs.map(
      (program) => `- ${program.name} (${program.id}) · 版本 ${program.versionCount} · 条目 ${program.entryCount}`,
    );
    return ok([
      `建设主题(共 ${programs.length} 个):`,
      '',
      ...lines,
      '',
      '版本/需求请用 list_versions / list_requirements 获取 id;主题只能由用户在页面创建,AI 不得创建或猜名称(本工具只读)。',
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
