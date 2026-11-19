// backend/src/interfaces/mcp/tools/conclusion/query-conclusions.ts
// query_conclusions:无 cardId=按条件搜索摘要(用于定位);有 cardId=读最新版完整内容+演进摘要。
import type { ConclusionDetail, ConclusionQueryRequest, ProblemScope } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.query_conclusions.name,
  description: CATALOG.query_conclusions.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      cardId: {
        type: 'string' as const,
        description: '已知 cardId 时直接传，读取该卡最新版完整内容与演进摘要；不要再用 keyword 搜索',
      },
      scope: { type: 'string' as const, enum: ['project', 'personal'], description: '按问题域过滤' },
      project: { type: 'string' as const, description: '按项目精确过滤' },
      version: { type: 'string' as const, description: '按版本精确过滤' },
      keyword: {
        type: 'string' as const,
        description: '仅在不知道 cardId 且用户明确要求查找时使用；匹配标题 + 全部历史版本内容。不要用于写前自动定位',
      },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '标签任一命中' },
      dateFrom: { type: 'string' as const, description: '起始日期 YYYY-MM-DD（按最新版日期）' },
      dateTo: { type: 'string' as const, description: '结束日期 YYYY-MM-DD' },
      limit: { type: 'number' as const, description: '返回条数上限，默认 20' },
      includeHistory: { type: 'boolean' as const, description: 'cardId 模式下是否返回全部历史全文，默认 false' },
    },
  },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formatDetail(detail: ConclusionDetail): string {
  const latest = detail.latest;
  const lines = [
    `### ${detail.title}（rev ${detail.rev}）`,
    [
      detail.project ?? '个人',
      detail.version,
      latest.date,
      latest.source.tool,
      detail.conversationName ?? latest.source.conversationName,
      detail.conversationId
        ? `ID ${detail.conversationId}`
        : latest.source.conversationId ? `ID ${latest.source.conversationId}` : undefined,
    ].filter(Boolean).join(' · '),
    '',
    '## 结论/决策',
    latest.decision,
  ];
  if (latest.data) lines.push('', '## 关键数据', latest.data);
  if (latest.openItems) lines.push('', '## 待办/未决', latest.openItems);
  if (latest.codeRefs?.length) {
    lines.push('', '## 代码/文件位置',
      ...latest.codeRefs.map((ref) => `- ${ref.path}${ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}${ref.note ? ` — ${ref.note}` : ''}`));
  }
  lines.push('', '## 演进');
  for (const revision of [...detail.revisions].reverse()) {
    lines.push(
      `- rev ${revision.rev} · ${revision.date} · ${revision.tool}`
      + `${revision.conversationName ? ` · ${revision.conversationName}` : ''}`
      + `${revision.conversationId ? ` · ID ${revision.conversationId}` : ''}`
      + `${revision.changeNote ? ` — ${revision.changeNote}` : ''}`,
    );
  }
  if (detail.history?.length) {
    lines.push('', '## 历史全文');
    for (const revision of [...detail.history].reverse()) {
      lines.push(
        `### rev ${revision.rev} · ${revision.date} · ${revision.source.tool}` +
        `${revision.source.conversationName ? ` · ${revision.source.conversationName}` : ''}` +
        `${revision.source.conversationId ? ` · ID ${revision.source.conversationId}` : ''}` +
        `${revision.changeNote ? ` — ${revision.changeNote}` : ''}`,
        '',
        revision.decision,
      );
      if (revision.data) lines.push('', '数据：', revision.data);
      if (revision.openItems) lines.push('', '待办：', revision.openItems);
    }
  }
  return lines.join('\n');
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    if (typeof args.cardId === 'string' && args.cardId) {
      const detail = await deps.conclusionService.getDetail(args.cardId, args.includeHistory === true);
      return ok(formatDetail(detail));
    }

    const input: ConclusionQueryRequest = {
      scope: args.scope === 'project' || args.scope === 'personal'
        ? args.scope as ProblemScope : undefined,
      project: text(args.project),
      version: text(args.version),
      keyword: text(args.keyword),
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      dateFrom: text(args.dateFrom),
      dateTo: text(args.dateTo),
      limit: typeof args.limit === 'number' ? args.limit : 20,
    };
    const summaries = await deps.conclusionService.query(input);
    if (summaries.length === 0) return ok('未找到匹配的结论卡。');

    return ok(`共 ${summaries.length} 张：\n\n${summaries.map((card) => [
      `### ${card.title}（${card.id} · rev ${card.rev}）`,
      [
        card.project ?? '个人',
        card.version,
        card.latestDate,
        card.source.tool,
        card.source.conversationName,
      ].filter(Boolean).join(' · '),
      // 历史命中提示:同时给出「命中历史版本」语义与「命中 rev N」短标签
      card.matchedRev ? `命中历史版本：rev ${card.matchedRev}（命中 rev ${card.matchedRev}）` : '',
      '',
      card.latestDecisionExcerpt,
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')}`);
  } catch (err) {
    return fail(err);
  }
}
