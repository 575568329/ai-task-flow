// backend/src/interfaces/mcp/tools/worklog/record-work.ts
import type { WorkStage } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
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
        description: '标签,约定 feat/fix/refactor/docs,可选(缺陷修改用 fix)',
      },
      relatedProjects: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '同时涉及的其他项目名称(可选)',
      },
      stage: STAGE_SCHEMA,
    },
    required: ['project', 'version', 'title', 'detail', 'stage'],
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
      relatedProjects: Array.isArray(args.relatedProjects) ? (args.relatedProjects as string[]) : undefined,
      // cwd 不暴露给 AI:记录端进程所在目录,用于服务端按项目路径归属记录
      sourcePath: process.cwd(),
      stage: args.stage as WorkStage | undefined,
    });
    const notes: string[] = ['✅ 已记录'];
    if (result.createdProject) notes.push(`(已新建项目 "${String(args.project)}")`);
    if (result.createdVersion) notes.push(`(已新建版本 "${String(args.version)}"——若非本意请用 rename_version 纠正)`);
    // warnings:关联项目拼错被忽略、路径未归属等,必须回传给 AI 让它可纠正
    const warnings = (result.warnings ?? []).map((w) => `⚠ ${w}`);
    return ok([
      ...notes,
      '',
      `**路径**: \`${result.path}\``,
      ...(warnings.length ? ['', ...warnings] : []),
      '',
      '工作记录页刷新可见。',
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
