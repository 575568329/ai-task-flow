// backend/src/interfaces/mcp/tools/worklog/list-requirements.ts
// 只读:让 AI 拿到 requirementId(需求只能由用户在页面创建,AI 不得创建或猜名称)。
import type { WorklogData, WorklogVersion } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.list_requirements.name,
  description: CATALOG.list_requirements.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      versionId: { type: 'string' as const, description: '只看该版本的需求(如 v_ab12cd34,先 list_versions 获取);不传则列出全部,可选' },
    },
  },
};

/** 候选清单文案:最多 5 个,形如「V8.0.8(v_ab12)」;空则明确标注 */
function versionCandidates(data: WorklogData): string {
  if (!data.versions.length) return '（暂无）';
  return data.versions.slice(0, 5).map((v) => `${v.name}(${v.id})`).join('、');
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const data = await deps.worklogService.getTree();
    const versionId = args.versionId ? String(args.versionId).trim() : '';
    let versions: WorklogVersion[] = data.versions;
    if (versionId) {
      const found = data.versions.find((v) => v.id === versionId);
      if (!found) {
        return fail(new Error(
          `版本 ${versionId} 不存在；现有版本：${versionCandidates(data)}。请让用户在页面创建并复制 id`,
        ));
      }
      versions = [found];
    }

    const rows = versions.flatMap((version) =>
      version.requirements.map((requirement) => ({ version, requirement })),
    );
    if (rows.length === 0) {
      const where = versionId ? '该版本' : '全部版本';
      return ok(`${where}暂无需求。请让用户在页面创建需求后获取 id(本工具只读)。`);
    }

    const lines = rows.map(({ version, requirement }) => {
      const projects = requirement.projects?.length ? requirement.projects.join(',') : '无';
      return `- ${requirement.title} (${requirement.id}) · 版本: ${version.name}(${version.id}) · 关联: ${projects} · 条目 ${requirement.entries.length}`;
    });
    const scope = versionId ? `版本 ${versions[0].name} 的需求` : '全部需求';
    return ok([
      `${scope}(共 ${rows.length} 个):`,
      '',
      ...lines,
      '',
      '记录时把 requirementId 与所属 versionId 传给 record_work;需求只能由用户在页面创建,AI 不得创建或猜名称(本工具只读)。',
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
