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
  list_programs: CATALOG_BY_NAME.list_programs,
  list_versions: CATALOG_BY_NAME.list_versions,
  list_requirements: CATALOG_BY_NAME.list_requirements,
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

/** MCP 入参归一:字符串数组。非数组整项忽略、元素类型不对丢弃,并写一条提示。
 *  AI 客户端可能传 ["a", 1] 或 "a":直接透传会让服务层 .map / for-of 出错(500),
 *  这里降级为「忽略 + 提示」而不是让整次记录失败。 */
export function normalizeStringArray(
  value: unknown,
  field: string,
  notices: string[],
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    notices.push(`${field} 不是字符串数组,已忽略`);
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  if (strings.length !== value.length) {
    notices.push(`${field} 中有 ${value.length - strings.length} 个非字符串项,已忽略`);
  }
  return strings;
}

/** MCP 入参归一:可选字符串。非字符串忽略并提示 */
export function normalizeOptionalString(
  value: unknown,
  field: string,
  notices: string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    notices.push(`${field} 不是字符串,已忽略`);
    return undefined;
  }
  return value;
}

/** MCP 入参归一:files 只校验外层是数组(元素结构由服务层 validateFiles 校验并报 400) */
export function normalizeFiles(value: unknown, notices: string[]): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    notices.push('files 不是数组,已忽略');
    return undefined;
  }
  return value;
}
