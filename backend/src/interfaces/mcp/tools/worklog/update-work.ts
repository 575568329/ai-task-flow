// backend/src/interfaces/mcp/tools/worklog/update-work.ts
import type { WorkStage } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
import { CATALOG, ok, fail, normalizeFiles, normalizeStringArray } from './_shared.js';

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
    // 类型不对的可选字段(字符串/数组)降级为忽略 + 提示,不让坏结构进服务层抛 500
    const notices: string[] = [];
    const tags = normalizeStringArray(args.tags, 'tags', notices);
    const relatedProjects = normalizeStringArray(args.relatedProjects, 'relatedProjects', notices);
    const files = normalizeFiles(args.files, notices);

    const result = await deps.worklogService.update(String(args.entryId ?? ''), {
      title: args.title !== undefined ? String(args.title) : undefined,
      detail: args.detail !== undefined ? String(args.detail) : undefined,
      tags,
      stage: args.stage as WorkStage | undefined,
      files: files as never,
      diff: args.diff !== undefined ? String(args.diff) : undefined,
      date: args.date !== undefined ? String(args.date) : undefined,
      relatedProjects,
    });
    // 类型纠正提示 + 关联项目拼错被忽略等警告,回传让 AI 可纠正
    const warnings = [
      ...notices.map((n) => `⚠ ${n}`),
      ...(result.warnings ?? []).map((w) => `⚠ ${w}`),
    ];
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
