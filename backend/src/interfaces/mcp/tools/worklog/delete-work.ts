// backend/src/interfaces/mcp/tools/worklog/delete-work.ts
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.delete_work.name,
  description: CATALOG.delete_work.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      entryId: { type: 'string' as const, description: '要删除的条目 id(e_xxx)' },
    },
    required: ['entryId'],
  },
};

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    await deps.worklogService.deleteEntry(String(args.entryId ?? ''));
    return ok('✅ 已删除该条记录(删除前已自动快照备份,如误删可从 ~/.ai-task-flow/worklog-backups/ 恢复)。');
  } catch (err) {
    return fail(err);
  }
}
