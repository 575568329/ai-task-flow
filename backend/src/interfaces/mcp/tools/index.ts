// backend/src/interfaces/mcp/tools/index.ts
// Barrel export: 所有 MCP 工具处理器
// Step1(worklog 转型):任务工具已移除,暂只留 save_to_knowledge;
// Step4 将注册 worklog 九工具(record_work/query_work/list_projects 等)。
import type { ToolDeps } from './types.js';
import { toolDef as t6, handle as h6 } from './save-to-knowledge.js';

/** 所有工具定义的有序列表 */
export const ALL_TOOLS = [t6];

/** 工具名 → 处理器的映射 */
export const HANDLERS: Record<
  string,
  (args: Record<string, unknown> | undefined, deps: ToolDeps) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
> = {
  save_to_knowledge: h6,
};
