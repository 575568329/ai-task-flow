// backend/src/interfaces/mcp/tools/index.ts
// Barrel export: 所有 MCP 工具处理器。
// worklog 九工具的 name/description 单一来源为 shared mcpToolCatalog。
import type { ToolDeps } from './types.js';
import { toolDef as knowledgeDef, handle as knowledgeHandler } from './save-to-knowledge.js';
import { toolDef as recordDef, handle as recordHandler } from './worklog/record-work.js';
import { toolDef as queryDef, handle as queryHandler } from './worklog/query-work.js';
import { toolDef as listProjectsDef, handle as listProjectsHandler } from './worklog/list-projects.js';
import { toolDef as updateDef, handle as updateHandler } from './worklog/update-work.js';
import { toolDef as deleteWorkDef, handle as deleteWorkHandler } from './worklog/delete-work.js';
import { toolDef as deleteVersionDef, handle as deleteVersionHandler } from './worklog/delete-version.js';
import { toolDef as deleteProjectDef, handle as deleteProjectHandler } from './worklog/delete-project.js';
import { toolDef as renameVersionDef, handle as renameVersionHandler } from './worklog/rename-version.js';
import { toolDef as renameProjectDef, handle as renameProjectHandler } from './worklog/rename-project.js';

export type ToolHandler = (
  args: Record<string, unknown> | undefined,
  deps: ToolDeps,
) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

/** 所有工具定义的有序列表 */
export const ALL_TOOLS = [
  recordDef,
  queryDef,
  listProjectsDef,
  updateDef,
  deleteWorkDef,
  deleteVersionDef,
  deleteProjectDef,
  renameVersionDef,
  renameProjectDef,
  knowledgeDef,
];

/** 工具名 → 处理器的映射 */
export const HANDLERS: Record<string, ToolHandler> = {
  record_work: recordHandler,
  query_work: queryHandler,
  list_projects: listProjectsHandler,
  update_work: updateHandler,
  delete_work: deleteWorkHandler,
  delete_version: deleteVersionHandler,
  delete_project: deleteProjectHandler,
  rename_version: renameVersionHandler,
  rename_project: renameProjectHandler,
  save_to_knowledge: knowledgeHandler,
};
