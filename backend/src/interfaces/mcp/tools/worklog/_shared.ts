// backend/src/interfaces/mcp/tools/worklog/_shared.ts
// worklog MCP 工具共享:name/description 单一来源取自 shared mcpToolCatalog,
// 错误统一包装为 isError:true + AI 可读文本(客户端可识别失败,不抛崩连接)。
import { WORKLOG_TOOL_CATALOG, type WorklogToolMeta } from '@ai-task-flow/shared';

/** 工具名 → 元数据(catalog 单一来源) */
export const CATALOG_BY_NAME: Record<string, WorklogToolMeta> = Object.fromEntries(
  WORKLOG_TOOL_CATALOG.map((meta) => [meta.name, meta]),
);

/** 便捷取用(编译期保证工具名拼写) */
export const CATALOG = {
  record_work: CATALOG_BY_NAME.record_work,
  query_work: CATALOG_BY_NAME.query_work,
  list_projects: CATALOG_BY_NAME.list_projects,
  update_work: CATALOG_BY_NAME.update_work,
  delete_work: CATALOG_BY_NAME.delete_work,
  delete_version: CATALOG_BY_NAME.delete_version,
  delete_project: CATALOG_BY_NAME.delete_project,
  rename_version: CATALOG_BY_NAME.rename_version,
  rename_project: CATALOG_BY_NAME.rename_project,
} as const;

export type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function ok(text: string): McpTextResult {
  return { content: [{ type: 'text', text }] };
}

export function fail(err: unknown): McpTextResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `❌ ${message}` }], isError: true };
}
