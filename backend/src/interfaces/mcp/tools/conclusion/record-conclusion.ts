// backend/src/interfaces/mcp/tools/conclusion/record-conclusion.ts
// record_conclusion:无 cardId=按当前会话自动 upsert(有则续写/无则新建);
// 有 cardId=显式追加指定卡(省略字段沿用上一版)。
import type {
  ConclusionAppendRequest,
  ConclusionCodeRef,
  ConclusionRecordRequest,
  ConclusionSource,
  ProblemScope,
  WorkStage,
} from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { STAGE_SCHEMA } from '../stageSchema.js';
import { resolveConclusionProjects } from '../../../conclusionProjectResolve.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.record_conclusion.name,
  description: CATALOG.record_conclusion.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      cardId: {
        type: 'string' as const,
        description: '可选。不传=按当前会话自动续写/新建；传=显式更新指定卡（跨对话需 allowCrossConversation=true）',
      },
      expectedRev: { type: 'number' as const, description: '自动续写不需要；显式 cardId 更新时建议传：读取到的当前版本号，不一致返回冲突' },
      allowCrossConversation: {
        type: 'boolean' as const,
        description: '仅显式 cardId 跨对话更新时使用；自动续写（不传 cardId）不需要',
      },
      scope: { type: 'string' as const, enum: ['project', 'personal'], description: '项目问题还是个人问题' },
      project: { type: 'string' as const, description: '项目名（scope=project 必填）' },
      relatedProjects: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '关联项目名称（本项目还涉及的其他工程）；不存在的名称会被忽略并在返回中提示',
      },
      version: { type: 'string' as const, description: '版本名（可选，仅项目问题）' },
      title: { type: 'string' as const, description: '结论卡主题（新建必填；自动续写时可省略或更新）' },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '标签，可选' },
      decision: { type: 'string' as const, description: '结论/决策 + 理由（Markdown）；新建必填，自动续写省略=沿用' },
      data: { type: 'string' as const, description: '关键数据/命令结果；追加省略=沿用，传空串=清空' },
      openItems: { type: 'string' as const, description: '待办/未决问题；追加省略=沿用，传空串=清空' },
      codeRefs: {
        type: 'array' as const,
        description: '代码/文件位置；追加省略=沿用，传空数组=清空',
        items: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' as const, description: '相对仓库根路径' },
            startLine: { type: 'number' as const },
            endLine: { type: 'number' as const },
            note: { type: 'string' as const },
          },
          required: ['path'],
        },
      },
      date: { type: 'string' as const, description: '本版业务日期 YYYY-MM-DD，默认当天' },
      changeNote: { type: 'string' as const, description: '本版为什么更新（同一会话后续记录必填；新建时可省略）' },
      stage: { ...STAGE_SCHEMA, description: `${STAGE_SCHEMA.description}新建建议填写；同一对话追加省略=沿用上一版` },
      conversationName: {
        type: 'string' as const,
        description: '对话名称（建议填写本次对话主题，如「worklog 全局搜索方案」；不填则页面只显示对话 ID）',
      },
    },
  },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const source: ConclusionSource = {
      ...deps.mcpSource,
      ...(text(args.conversationName) ? { conversationName: text(args.conversationName) } : {}),
    };
    const scope: ProblemScope | undefined = args.scope === 'personal' || args.scope === 'project'
      ? args.scope
      : undefined;
    const project = text(args.project);
    const relatedProjects = Array.isArray(args.relatedProjects)
      ? args.relatedProjects.map(String)
      : undefined;

    // 结论卡不按路径归属:仅当显式传了项目信息时查 worklog 做「名称 → id」解析
    // (getProjectRefs 不 probe 路径,建卡不会因路径失效而变慢或报错)
    const resolved = project !== undefined || relatedProjects !== undefined
      ? resolveConclusionProjects(
          await deps.worklogService.getProjectRefs(),
          { project, relatedProjects },
        )
      : undefined;
    const projectRefs = resolved
      ? {
          ...(resolved.projectId !== undefined ? { projectId: resolved.projectId } : {}),
          ...(resolved.relatedProjects !== undefined
            ? { relatedProjects: resolved.relatedProjects, relatedProjectIds: resolved.relatedProjectIds }
            : {}),
        }
      : {};
    const notices: string[] = [];
    if (resolved?.ignored.length) {
      notices.push(`⚠ 以下关联项目不存在，已忽略：${resolved.ignored.join(', ')}`);
    }
    if (resolved?.projectMissing) {
      notices.push(`⚠ 项目「${project}」尚未建立，projectId 暂时留空（保留名称快照）`);
    }

    if (typeof args.cardId === 'string' && args.cardId) {
      // 追加:注意对象里不含 cardId 字段(它在 append 的入参位置,不属于请求体)
      const append: ConclusionAppendRequest = {
        expectedRev: num(args.expectedRev),
        allowCrossConversation: args.allowCrossConversation === true,
        scope,
        project,
        version: text(args.version),
        title: text(args.title),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        decision: text(args.decision),
        data: text(args.data),
        openItems: text(args.openItems),
        codeRefs: Array.isArray(args.codeRefs) ? args.codeRefs as ConclusionCodeRef[] : undefined,
        date: text(args.date),
        changeNote: text(args.changeNote) ?? '',
        conversationName: text(args.conversationName),
        stage: args.stage as WorkStage | undefined,
        ...projectRefs,
      };
      const result = await deps.conclusionService.append(args.cardId, append, source);
      return ok([
        `✅ 已追加到 ${result.id} → rev ${result.rev}`,
        ...(append.changeNote ? [`变更说明：${append.changeNote}`] : []),
        ...notices,
      ].join('\n'));
    }

    // 自动 upsert：按当前会话找卡；有则续写，无则新建。
    const record: ConclusionRecordRequest = {
      scope,
      project,
      version: text(args.version),
      title: text(args.title),
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      decision: text(args.decision),
      data: text(args.data),
      openItems: text(args.openItems),
      codeRefs: Array.isArray(args.codeRefs) ? args.codeRefs as ConclusionCodeRef[] : undefined,
      date: text(args.date),
      changeNote: text(args.changeNote),
      conversationName: text(args.conversationName),
      stage: args.stage as WorkStage | undefined,
      expectedRev: num(args.expectedRev),
      allowCrossConversation: args.allowCrossConversation === true,
      ...projectRefs,
    };
    const result = await deps.conclusionService.record(record, source);
    if (result.created) {
      return ok([
        `✅ 已创建结论卡 ${result.id}（${record.project ?? '个人'} · rev ${result.rev}）`,
        '本会话后续记录会自动续写到这张卡，无需先查询或再传 cardId。',
        ...notices,
      ].join('\n'));
    }
    return ok([
      `✅ 已续写同一会话结论卡 ${result.id} → rev ${result.rev}`,
      ...(record.changeNote ? [`变更说明：${record.changeNote}`] : []),
      ...notices,
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
