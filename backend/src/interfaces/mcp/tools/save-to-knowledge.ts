// backend/src/interfaces/mcp/tools/save-to-knowledge.ts
// 知识库写入工具:创建新文档,可选写入版本/项目/阶段软关联。
// 关联 id 不存在时降级为不写该字段并提示,不阻断文档保存(设计 §8)。
import { WORK_STAGE_IDS, isWorkStage } from '@ai-task-flow/shared';
import type { WorklogData } from '@ai-task-flow/shared';
import { extractFrontmatterBlock } from '../../../application/knowledge/frontmatter.js';
import type { ToolDeps } from './types.js';
import { STAGE_SCHEMA } from './stageSchema.js';

export const toolDef = {
  name: 'save_to_knowledge' as const,
  description:
    '将调研结论/笔记写入知识库(创建新 Markdown 文档,文件名由服务端按命名规则生成,调用方无法干预物理文件名)。' +
    '可选传 versionId / projectId / stage,用于知识库按版本/项目/阶段归类;' +
    'requirementId 已废弃(需求层已移除),传入会被忽略并提示,请改用 versionId;' +
    '关联 id 不存在时自动降级为不关联并提示,不影响文档保存。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string' as const,
        description: '文档标题(用作文件名一部分,特殊字符会被清洗)',
      },
      content: {
        type: 'string' as const,
        description: 'Markdown 正文',
      },
      tags: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '可选标签(写入 frontmatter)',
      },
      dir: {
        type: 'string' as const,
        description: '可选子目录(相对 knowledge-base/),不传则写根目录',
      },
      versionId: {
        type: 'string' as const,
        description: '可选版本 id(如 v_ab12cd34),用于知识库按版本归类;先 list_versions 获取,id 不存在则降级为不关联',
      },
      requirementId: {
        type: 'string' as const,
        description: '已废弃(需求层已移除):传入会被忽略并提示,请改用 versionId',
      },
      projectId: {
        type: 'string' as const,
        description: '可选项目 id(如 p_ab12cd34),用于按项目归类;先 list_projects 获取,id 不存在则降级为不关联',
      },
      stage: {
        ...STAGE_SCHEMA,
        description: `可选阶段标签,用于知识库按阶段归类。${STAGE_SCHEMA.description}`,
      },
    },
    required: ['title', 'content'],
  },
};

/** 请求的关联字段(已做空串归一) */
interface RequestedRefs {
  versionId?: string;
  requirementId?: string;
  projectId?: string;
  stage?: string;
}

/** 空串/null 归一为 undefined */
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/**
 * 校验关联 id 是否存在;不存在的字段降级为不写,并收集提示文案。
 * stage 不依赖 worklog,单独校验。
 */
async function resolveRefs(
  deps: ToolDeps,
  requested: RequestedRefs,
): Promise<{ meta: RequestedRefs; warnings: string[] }> {
  const meta: RequestedRefs = {};
  const warnings: string[] = [];

  if (requested.stage !== undefined) {
    if (isWorkStage(requested.stage)) {
      meta.stage = requested.stage;
    } else {
      warnings.push(
        `stage "${requested.stage}" 不是合法阶段,已降级为不写该字段` +
          `(可选值: ${WORK_STAGE_IDS.join('/')};缺陷修改用 tags 的 fix,不占 stage)`,
      );
    }
  }

  // 需求层已移除:任何 requirementId 都无法再解析,先于 needsTree 提前返回,避免「只传 requirementId」时无提示
  if (requested.requirementId) {
    warnings.push(
      `需求 id "${requested.requirementId}" 已废弃,将被忽略(需求层已移除,请改用 versionId)`,
    );
  }

  const needsTree = Boolean(requested.versionId || requested.projectId);
  if (!needsTree) return { meta, warnings };

  let tree: WorklogData;
  try {
    tree = await deps.worklogService.getTree();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`读取版本/项目数据失败(${message}),版本/项目关联已降级为不关联`);
    return { meta, warnings };
  }

  // 数据损坏(versions/projects 缺失)时按空数组处理,保持降级而不是抛错
  const versions = Array.isArray(tree?.versions) ? tree.versions : [];
  const projects = Array.isArray(tree?.projects) ? tree.projects : [];

  if (requested.versionId) {
    if (versions.some((v) => v?.id === requested.versionId)) {
      meta.versionId = requested.versionId;
    } else {
      warnings.push(`版本 id "${requested.versionId}" 不存在,已降级为不关联(可先 list_versions 获取)`);
    }
  }

  if (requested.projectId) {
    if (projects.some((p) => p?.id === requested.projectId)) {
      meta.projectId = requested.projectId;
    } else {
      warnings.push(`项目 id "${requested.projectId}" 不存在,已降级为不关联(可先 list_projects 获取)`);
    }
  }

  return { meta, warnings };
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  const title = String(args.title ?? '');
  const content = typeof args.content === 'string' ? args.content : '';
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
  const dir = optionalString(args.dir);

  if (!title.trim()) {
    throw new Error('title is required');
  }
  if (!content) {
    throw new Error('content is required');
  }

  const requested: RequestedRefs = {
    versionId: optionalString(args.versionId),
    requirementId: optionalString(args.requirementId),
    projectId: optionalString(args.projectId),
    stage: optionalString(args.stage),
  };
  const { meta, warnings } = await resolveRefs(deps, requested);
  // 正文自带任意前导块时 createDoc 会原样写入、不覆盖元数据,成功文案不能谎称已关联
  const contentHasFrontmatter = extractFrontmatterBlock(content).hasBlock;

  try {
    const result = await deps.knowledgeService.createDoc({ title, content, tags, dir, ...meta });
    const lines = [
      '✅ 已写入知识库',
      '',
      `**路径**: \`${result.path}\``,
    ];
    const associations = [
      meta.versionId ? `版本 \`${meta.versionId}\`` : '',
      meta.projectId ? `项目 \`${meta.projectId}\`` : '',
      meta.stage ? `阶段 \`${meta.stage}\`` : '',
    ].filter(Boolean);
    if (contentHasFrontmatter && (associations.length > 0 || (tags?.length ?? 0) > 0)) {
      warnings.push('文档自带 frontmatter,服务端未覆盖 frontmatter(传入的 tags/版本/需求/项目/阶段未写入)');
    }
    if (associations.length > 0 && !contentHasFrontmatter) {
      lines.push('', `**关联**: ${associations.join(' / ')}`);
    }
    if (warnings.length > 0) {
      lines.push('', ...warnings.map((w) => `⚠ ${w}`));
    }
    lines.push('', '文档已创建,前端知识库看板刷新即可见。');
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `❌ 写入知识库失败: ${error.message}` }],
    };
  }
}
