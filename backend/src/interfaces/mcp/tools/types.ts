// backend/src/interfaces/mcp/tools/types.ts
import type { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';
import type { WorklogService } from '../../../application/worklog/WorklogService.js';

/**
 * MCP 工具处理器共享依赖
 */
export interface ToolDeps {
  knowledgeService: KnowledgeService;
  worklogService: WorklogService;
}
