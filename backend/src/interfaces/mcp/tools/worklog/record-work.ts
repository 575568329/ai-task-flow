// backend/src/interfaces/mcp/tools/worklog/record-work.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.record_work.name,
  description: CATALOG.record_work.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: { type: 'string' as const, description: '项目名(唯一键,如 ai-task-flow)' },
      version: { type: 'string' as const, description: '版本名(自由文本,如 v1.2.0 / 11月迭代,不存在会自动创建)' },
      title: { type: 'string' as const, description: '一句话功能点' },
      detail: { type: 'string' as const, description: 'markdown 详细改动说明:改了什么/为什么/影响面' },
      files: {
        type: 'array' as const,
        description: '改动文件引用(从 git status/diff 提取),可选',
        items: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' as const, description: '相对仓库根路径' },
            startLine: { type: 'number' as const, description: '起始行,可选' },
            endLine: { type: 'number' as const, description: '结束行,可选' },
          },
          required: ['path'],
        },
      },
      diff: { type: 'string' as const, description: 'git diff 原始文本(记录时快照),可选' },
      tags: {
        type: 'array' as const, items: { type: 'string' as const },
        description: '标签,约定 feat/fix/refactor/docs,可选',
      },
    },
    required: ['project', 'version', 'title', 'detail'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const result = await deps.worklogService.record({
      project: String(args.project ?? ''),
      version: String(args.version ?? ''),
      title: String(args.title ?? ''),
      detail: String(args.detail ?? ''),
      files: args.files as never,
      diff: args.diff ? String(args.diff) : undefined,
      tags: args.tags as string[] | undefined,
    });
    const notes: string[] = ['✅ 已记录'];
    if (result.createdProject) notes.push(`(已新建项目 "${String(args.project)}")`);
    if (result.createdVersion) notes.push(`(已新建版本 "${String(args.version)}"——若非本意请用 rename_version 纠正)`);
    return ok([
      ...notes,
      '',
      `**路径**: \`${result.path}\``,
      '',
      '工作记录页刷新可见。',
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
