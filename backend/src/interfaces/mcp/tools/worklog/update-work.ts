// backend/src/interfaces/mcp/tools/worklog/update-work.ts
import type { ToolDeps } from '../types.js';
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
      files: { type: 'array' as const, description: '新文件引用,可选', items: { type: 'object' as const, properties: { path: { type: 'string' as const }, startLine: { type: 'number' as const }, endLine: { type: 'number' as const } }, required: ['path'] } },
      diff: { type: 'string' as const, description: '新 diff 原文,可选' },
      date: { type: 'string' as const, description: '新日期 YYYY-MM-DD,可选' },
      version: { type: 'string' as const, description: '挪到该版本(不存在自动创建),可选' },
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
      files: args.files as never,
      diff: args.diff !== undefined ? String(args.diff) : undefined,
      date: args.date !== undefined ? String(args.date) : undefined,
      version: args.version !== undefined ? String(args.version) : undefined,
    });
    return ok(`✅ 已更新(仅改动传入字段)\n\n**路径**: \`${result.path}\``);
  } catch (err) {
    return fail(err);
  }
}
