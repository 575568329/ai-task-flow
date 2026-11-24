// backend/src/interfaces/mcp/tools/worklog/list-versions.ts
// 只读:让 AI 拿到 versionId(版本只能由用户在页面创建,AI 不得创建或猜名称)。
// 新模型版本归属建设主题:输出主题名,支持按 programId 过滤。
import type { WorklogProgram, WorklogVersion } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.list_versions.name,
  description: CATALOG.list_versions.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      programId: {
        type: 'string' as const,
        description: '只看该主题下的版本(如 g_ab12cd34,先 list_programs 获取);不传则列出全部,可选',
      },
    },
  },
};

/** 候选清单文案:最多 5 个,形如「澳门底层数据建设(g_ab12)」;空则明确标注 */
function programCandidates(programs: WorklogProgram[]): string {
  if (!programs.length) return '（暂无）';
  return programs.slice(0, 5).map((p) => `${p.name}(${p.id})`).join('、');
}

/** 版本条目数 + 首末日期(版本直接持有条目) */
function summarize(version: WorklogVersion): { entryCount: number; firstDate?: string; lastDate?: string } {
  const dates: string[] = [];
  const entries = version.entries ?? [];
  for (const entry of entries) {
    if (entry.date) dates.push(entry.date);
  }
  dates.sort();
  return {
    entryCount: entries.length,
    ...(dates.length ? { firstDate: dates[0], lastDate: dates[dates.length - 1] } : {}),
  };
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const data = await deps.worklogService.getTree();
    const programId = args.programId ? String(args.programId).trim() : '';

    let versions = data.versions;
    if (programId) {
      const program = data.programs.find((p) => p.id === programId);
      if (!program) {
        return fail(new Error(
          `主题 ${programId} 不存在；现有主题：${programCandidates(data.programs)}。请让用户在页面新建主题并复制 id`,
        ));
      }
      versions = versions.filter((v) => v.programId === programId);
    }

    if (versions.length === 0) {
      const where = programId ? '该主题' : '';
      return ok(`${where}暂无版本。请让用户在页面创建版本后获取 id(本工具只读)。`);
    }

    const programNameById = new Map(data.programs.map((p) => [p.id, p.name]));
    const lines = versions.map((version) => {
      const { entryCount, firstDate, lastDate } = summarize(version);
      const range = firstDate ? ` · ${firstDate}~${lastDate}` : '';
      // 悬空归属(指向已不存在的主题)与前端同一文案,便于对照页面排查
      const programName = programNameById.get(version.programId) ?? '未归属主题';
      return `- ${version.name} (${version.id ?? '未迁移'}) · ${programName} · 条目 ${entryCount}${range}`;
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
