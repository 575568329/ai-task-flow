// backend/src/interfaces/mcp/tools/index.ts
// Barrel export: 所有 MCP 工具处理器
import type { ToolDeps } from './types.js';
import { toolDef as t1, handle as h1 } from './list-pending-tasks.js';
import { toolDef as t2, handle as h2 } from './get-task.js';
import { toolDef as t3, handle as h3 } from './record-result.js';
import { toolDef as t4, handle as h4 } from './complete-step.js';
import { toolDef as t5, handle as h5 } from './add-note-to-task.js';
import { toolDef as t6, handle as h6 } from './save-to-knowledge.js';

/** 所有工具定义的有序列表 */
export const ALL_TOOLS = [t1, t2, t3, t4, t5, t6];

/** 工具名 → 处理器的映射 */
export const HANDLERS: Record<
  string,
  (args: Record<string, unknown> | undefined, deps: ToolDeps) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
> = {
  list_pending_tasks: h1,
  get_task: h2,
  record_result: h3,
  complete_step: h4,
  add_note_to_task: h5,
  save_to_knowledge: h6,
};
