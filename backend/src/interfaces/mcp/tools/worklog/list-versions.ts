// backend/src/interfaces/mcp/tools/worklog/list-versions.ts
// 只读:让 AI 拿到 versionId(版本只能由用户在页面创建,AI 不得创建或猜名称)。
import type { WorklogVersion } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.list_versions.name,
  description: CATALOG.list_versions.description,
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

/** 版本条目数 + 首末日期(仅统计该版本下全部需求的条目) */
function summarize(version: WorklogVersion): { entryCount: number; firstDate?: string; lastDate?: string } {
  const dates: string[] = [];
  let entryCount = 0;
  for (const requirement of version.requirements) {
    for (const entry of requirement.entries) {
      entryCount++;
      if (entry.date) dates.push(entry.date);
    }
  }
  dates.sort();
  return {
    entryCount,
    ...(dates.length ? { firstDate: dates[0], lastDate: dates[dates.length - 1] } : {}),
  };
}

export async function handle(_args: Record<string, unknown> | undefined, deps: ToolDeps) {
  try {
    const { versions } = await deps.worklogService.getTree();
    if (versions.length === 0) {
      return ok('暂无版本。请让用户在页面创建版本后获取 id(本工具只读)。');
    }

    const lines = versions.map((version) => {
      const { entryCount, firstDate, lastDate } = summarize(version);
      const range = firstDate ? ` · ${firstDate}~${lastDate}` : '';
      return `- ${version.name} (${version.id ?? '未迁移'}) · 需求 ${version.requirements.length} · 条目 ${entryCount}${range}`;
    });
    return ok([
      `版本(共 ${versions.length} 个):`,
      '',
      ...lines,
      '',
      `记录时把 id 传给 record_work;版本只能由用户在页面创建,AI 不得创建或猜名称(本工具只读)。`,
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
