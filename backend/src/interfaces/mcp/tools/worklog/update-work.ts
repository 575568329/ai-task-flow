// backend/src/interfaces/mcp/tools/worklog/update-work.ts
import type { WorkStage } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.update_work.name,
  description: CATALOG.update_work.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      entryId: { type: 'string' as const, description: '目标条目 id(record 返回的 e_xxx)' },
      title: { type: 'string' as const, description: '新标题,可选' },
      detail: { type: 'string' as const, description: '新详细说明,可选' },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '新标签,可选' },
      stage: { ...STAGE_SCHEMA, description: `${STAGE_SCHEMA.description}传新值则修改阶段,可选` },
      files: { type: 'array' as const, description: '新文件引用,可选', items: { type: 'object' as const, properties: { path: { type: 'string' as const }, startLine: { type: 'number' as const }, endLine: { type: 'number' as const } }, required: ['path'] } },
      diff: { type: 'string' as const, description: '新 diff 原文,可选' },
      date: { type: 'string' as const, description: '新日期 YYYY-MM-DD,可选' },
      relatedProjects: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '新关联项目名称列表,可选;传空数组表示清空关联',
      },
    },
    required: ['entryId'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const result = await deps.worklogService.update(String(args.entryId ?? ''), {
      title: args.title !== undefined ? String(args.title) : undefined,
      detail: args.detail !== undefined ? String(args.detail) : undefined,
      tags: args.tags as string[] | undefined,
      stage: args.stage as WorkStage | undefined,
      files: args.files as never,
      diff: args.diff !== undefined ? String(args.diff) : undefined,
      date: args.date !== undefined ? String(args.date) : undefined,
      relatedProjects: Array.isArray(args.relatedProjects) ? (args.relatedProjects as string[]) : undefined,
    });
    // 关联项目拼错被忽略时回传警告,让 AI 可纠正
    const warnings = (result.warnings ?? []).map((w) => `⚠ ${w}`);
    return ok([
      '✅ 已更新(仅改动传入字段)',
      '',
      `**路径**: \`${result.path}\``,
      ...(warnings.length ? ['', ...warnings] : []),
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
