// backend/src/interfaces/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { JsonTaskRepository } from '../../infrastructure/persistence/JsonTaskRepository.js';
import { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { knowledgeDirPath } from '../../config/dataDir.js';
import type { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
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

    // MCP 进程手工装配(MCP 是 stdio server,不经 HTTP;原 tsyringe container 已移除,决策项2A)。
    // TaskRepository 用默认实例(读默认 ~/.ai-task-flow/tasks.json)。MCP 写入触发 HTTP 侧
    // 刷新靠 TaskFileWatcher 轮询,未接 EventBus(报告 P1 议题,本次不动)。
    this.taskRepository = new JsonTaskRepository();
    this.knowledgeService = new KnowledgeService(knowledgeDirPath());

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
