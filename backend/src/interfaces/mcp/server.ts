// backend/src/interfaces/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * AI Task Flow MCP Server
 *
 * 提供给 Claude Code 的 MCP 工具：
 * - list_pending_tasks: 列出待办任务
 * - get_task: 获取任务详情
 * - record_result: 记录执行结果
 * - get_task_diff: 获取 worktree diff
 * - add_note_to_task: 添加备注
 */

class AITaskFlowServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'ai-task-flow',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_pending_tasks',
          description: '列出所有待办或已派发的任务',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['todo', 'dispatched', 'all'],
                description: '筛选状态，默认 todo',
              },
            },
          },
        },
        {
          name: 'get_task',
          description: '获取任务详情（含 Markdown 格式化）',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: '任务 ID（例如 WS-001）',
              },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'record_result',
          description: '记录任务执行结果',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              status: {
                type: 'string',
                enum: ['done', 'partial', 'blocked'],
              },
              changedFiles: {
                type: 'array',
                items: { type: 'string' },
              },
              notes: { type: 'string' },
              reviewPoints: {
                type: 'array',
                items: { type: 'string' },
              },
              blockedReason: { type: 'string' },
            },
            required: ['taskId', 'status', 'changedFiles', 'notes'],
          },
        },
      ],
    }));

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_pending_tasks':
          return this.handleListPendingTasks(args);
        case 'get_task':
          return this.handleGetTask(args);
        case 'record_result':
          return this.handleRecordResult(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleListPendingTasks(args: any) {
    // TODO: 实现逻辑
    return {
      content: [
        {
          type: 'text',
          text: 'List pending tasks - TODO',
        },
      ],
    };
  }

  private async handleGetTask(args: any) {
    // TODO: 实现逻辑
    return {
      content: [
        {
          type: 'text',
          text: `Get task ${args.taskId} - TODO`,
        },
      ],
    };
  }

  private async handleRecordResult(args: any) {
    // TODO: 实现逻辑
    return {
      content: [
        {
          type: 'text',
          text: `Record result for ${args.taskId} - TODO`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AI Task Flow MCP Server running on stdio');
  }
}

// 启动服务器
const server = new AITaskFlowServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

