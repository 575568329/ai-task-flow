// backend/src/interfaces/mcp/tools/worklog/query-work.ts
import { WORK_STAGE_LABELS, type WorkStage } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.query_work.name,
  description: CATALOG.query_work.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      entryId: { type: 'string' as const, description: '按条目 id 精确查询(如 e_d3744a73,页面上可复制);传入时忽略其他过滤条件,可选' },
      project: { type: 'string' as const, description: '按项目精确过滤,可选' },
      version: { type: 'string' as const, description: '按版本精确过滤,可选' },
      keyword: { type: 'string' as const, description: '关键词,对标题/详情/文件路径不区分大小写模糊,可选' },
      relatedProject: { type: 'string' as const, description: '按关联项目名称过滤(条目同时涉及该项目),可选' },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '标签任一命中,可选' },
      stage: { ...STAGE_SCHEMA, description: `${STAGE_SCHEMA.description}按该阶段过滤,可选` },
      dateFrom: { type: 'string' as const, description: '起始日期 YYYY-MM-DD(含),可选' },
      dateTo: { type: 'string' as const, description: '结束日期 YYYY-MM-DD(含),可选' },
      limit: { type: 'number' as const, description: '返回条数上限,默认 20' },
      includeDiff: { type: 'boolean' as const, description: '是否携带 diff 原文(体积大,确需时才开),默认 false' },
    },
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const entries = await deps.worklogService.query({
      entryId: args.entryId ? String(args.entryId) : undefined,
      project: args.project ? String(args.project) : undefined,
      version: args.version ? String(args.version) : undefined,
      keyword: args.keyword ? String(args.keyword) : undefined,
      relatedProject: args.relatedProject ? String(args.relatedProject) : undefined,
      tags: args.tags as string[] | undefined,
      stage: args.stage as WorkStage | undefined,
      dateFrom: args.dateFrom ? String(args.dateFrom) : undefined,
      dateTo: args.dateTo ? String(args.dateTo) : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      includeDiff: args.includeDiff === true,
    });

    if (entries.length === 0) return ok('未找到匹配的工作记录。');

    const lines = entries.map((e) => {
      const head = `### ${e.title}`;
      const stage = e.stage ? WORK_STAGE_LABELS[e.stage] : '未标注';
      const related = e.relatedProjects?.length ? [`关联:${e.relatedProjects.join(',')}`] : [];
      const meta = [`ID:${e.id}`, `${e.project}/${e.version}`, e.date, `阶段:${stage}`, ...related, ...(e.tags ?? [])].join(' · ');
      const files = e.files?.length ? `\n文件: ${e.files.join(', ')}` : '';
      const unmatched = e.pathUnmatched ? '\n⚠ 路径未归属任何项目，可在页面绑定路径' : '';
      const diff = e.diff ? `\n\n\`\`\`diff\n${e.diff}\n\`\`\`` : '';
      return `${head}\n${meta}${files}${unmatched}\n\n${e.detail}${diff}`;
    });
    return ok(`共 ${entries.length} 条:\n\n${lines.join('\n\n---\n\n')}`);
  } catch (err) {
    return fail(err);
  }
}
