// backend/src/interfaces/mcp/tools/conclusion/_shared.ts
// 结论卡 MCP 工具共享:name/description 单一来源取自 shared mcpToolCatalog,
// 错误统一包装为 isError:true + AI 可读文本(客户端可识别失败,不抛崩连接)。
import { CONCLUSION_TOOL_CATALOG, type ConclusionToolMeta } from '@ai-task-flow/shared';

/** 工具名 → 元数据(catalog 单一来源) */
export const CATALOG_BY_NAME: Record<string, ConclusionToolMeta> = Object.fromEntries(
  CONCLUSION_TOOL_CATALOG.map((meta) => [meta.name, meta]),
);

/** 便捷取用(编译期保证工具名拼写) */
export const CATALOG = {
  record_conclusion: CATALOG_BY_NAME.record_conclusion,
  query_conclusions: CATALOG_BY_NAME.query_conclusions,
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
