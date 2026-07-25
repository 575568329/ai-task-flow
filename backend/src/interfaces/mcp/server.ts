// backend/src/interfaces/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { container } from '../../infrastructure/di/container.js';
import type { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import type { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { ALL_TOOLS, HANDLERS } from './tools/index.js';

/**
 * AI Task Flow MCP Server
 *
 * 提供给 Claude Code 的 MCP 工具：
 * - list_pending_tasks: 列出待办任务
 * - get_task: 获取任务详情
 * - record_result: 记录执行结果
 * - complete_step: 标记步骤完成
 * - add_note_to_task: 添加备注
 * - save_to_knowledge: 写入知识库
 */
class AITaskFlowServer {
  private server: Server;
  private taskRepository: TaskRepository;
  private knowledgeService: KnowledgeService;

  constructor() {
    this.server = new Server(
      { name: 'ai-task-flow', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );

    this.taskRepository = container.resolve<TaskRepository>('TaskRepository');
    this.knowledgeService = container.resolve<KnowledgeService>('KnowledgeService');

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // 工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ALL_TOOLS,
    }));

    // 工具调用分发 → 独立处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = HANDLERS[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return handler(args, {
        taskRepository: this.taskRepository,
        knowledgeService: this.knowledgeService,
      });
    });

    // 知识库资源列表
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const manifest = await this.knowledgeService.getManifest();
      const resources = manifest.flatDocs
        .filter((d) => d.kind === 'md')
        .map((d) => ({
          uri: `knowledge://${d.path}`,
          name: d.title,
          mimeType: 'text/markdown',
        }));
      return { resources };
    });

    // 读取单个知识库资源
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      if (!uri.startsWith('knowledge://')) {
        throw new Error(`Unsupported resource uri: ${uri}`);
      }
      const relPath = uri.replace('knowledge://', '');
      const doc = await this.knowledgeService.getDoc(relPath);
      return {
        contents: [
          { uri, mimeType: 'text/markdown', text: doc.content ?? '' },
        ],
      };
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AI Task Flow MCP Server running on stdio');
  }
}

// 启动
const server = new AITaskFlowServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
