// backend/src/interfaces/mcp/tools/worklog/record-work.ts
// 新模型:版本由用户在页面创建,AI 只传 versionId;不存在时报服务层的可操作错误(含候选)。
import { isWorkStage, type WorkStage } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
import { CATALOG, ok, fail, normalizeFiles, normalizeOptionalString, normalizeStringArray } from './_shared.js';

export const toolDef = {
  name: CATALOG.record_work.name,
  description: CATALOG.record_work.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string' as const, description: '版本 id(如 v_ab12cd34),由用户在页面创建后复制;先 list_versions 获取' },
      title: { type: 'string' as const, description: '一句话功能点' },
      detail: { type: 'string' as const, description: 'markdown 详细改动说明:改了什么/为什么/影响面' },
      project: { type: 'string' as const, description: '本次实际改动的项目名(可选,不传按路径归属;项目须已存在)' },
      relatedProjects: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '同时涉及的其他项目名称(可选)',
      },
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
      stage: STAGE_SCHEMA,
    },
    required: ['versionId', 'title', 'detail', 'stage'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const versionId = String(args.versionId ?? '').trim();
    if (!versionId) {
      return fail(new Error('versionId 必填:请先 list_versions 获取版本 id,并让用户确认'));
    }
    if (!isWorkStage(args.stage)) {
      return fail(new Error(
        'stage 必填且必须是唯一阶段值(req/design/dev/self-test/review/coverage/release/retro);缺陷修改用 tags 的 fix,不占 stage',
      ));
    }

    // 类型不对的可选字段(字符串/数组)降级为忽略 + 提示,不让坏结构进服务层抛 500
    const notices: string[] = [];
    const project = normalizeOptionalString(args.project, 'project', notices);
    const tags = normalizeStringArray(args.tags, 'tags', notices);
    const relatedProjects = normalizeStringArray(args.relatedProjects, 'relatedProjects', notices);
    const files = normalizeFiles(args.files, notices);

    const result = await deps.worklogService.record({
      versionId,
      title: String(args.title ?? ''),
      detail: String(args.detail ?? ''),
      project,
      files: files as never,
      diff: args.diff ? String(args.diff) : undefined,
      tags,
      relatedProjects,
      // cwd 不暴露给 AI:记录端进程所在目录,用于服务端按项目路径归属记录
      sourcePath: process.cwd(),
      stage: args.stage as WorkStage,
    });

    // warnings:关联项目拼错被忽略、路径未归属等,必须回传给 AI 让它可纠正
    const warnings = [
      ...notices.map((n) => `⚠ ${n}`),
      ...(result.warnings ?? []).map((w) => `⚠ ${w}`),
    ];
    return ok([
      '✅ 已记录',
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
