// backend/src/interfaces/mcp/tools/types.ts
import type { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';
import type { WorklogService } from '../../../application/worklog/WorklogService.js';
import type { ConclusionService } from '../../../application/conclusion/ConclusionService.js';
import type { ConclusionSource } from '@ai-task-flow/shared';

/**
 * MCP 工具处理器共享依赖
 */
export interface ToolDeps {
  knowledgeService: KnowledgeService;
  worklogService: WorklogService;
  conclusionService: ConclusionService;
  /** 每次工具调用的宿主来源（MCP 进程环境 + clientInfo） */
  mcpSource: ConclusionSource;
}
