// backend/src/interfaces/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { WorklogService } from '../../application/worklog/WorklogService.js';
import { ConclusionService } from '../../application/conclusion/ConclusionService.js';
import { JsonWorklogRepository } from '../../infrastructure/persistence/JsonWorklogRepository.js';
import { JsonConclusionRepository } from '../../infrastructure/persistence/JsonConclusionRepository.js';
import {
  knowledgeDirPath,
  worklogFilePath,
  worklogBackupsDirPath,
  conclusionFilePath,
  conclusionBackupsDirPath,
} from '../../config/dataDir.js';
import { resolveMcpSource } from '../source.js';
import { ALL_TOOLS, HANDLERS } from './tools/index.js';

/**
 * AI Task Flow MCP Server
 *
 * 提供给 Claude Code/ZCode 的 MCP 工具：
 * - worklog 九工具(record_work/query_work/list_projects/update_work/delete_work/
 *   delete_version/delete_project/rename_version/rename_project)
 * - 结论卡双工具(record_conclusion/query_conclusions)
 * - save_to_knowledge: 写入知识库
 * 共 12 个工具。
 */
class AITaskFlowServer {
  private server: Server;
  private knowledgeService: KnowledgeService;
  private worklogService: WorklogService;
  private conclusionService: ConclusionService;

  constructor() {
    this.server = new Server(
      { name: 'ai-task-flow', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );

    // MCP 进程手工装配(MCP 是 stdio server,不经 HTTP)。
    // 与 HTTP backend 是两个 OS 进程——共享持久化文件,写协调靠 JsonWorklogRepository 的双层锁协议。
    this.knowledgeService = new KnowledgeService(knowledgeDirPath());
    this.worklogService = new WorklogService(
      new JsonWorklogRepository(worklogFilePath(), worklogBackupsDirPath()),
    );
    this.conclusionService = new ConclusionService(
      new JsonConclusionRepository(conclusionFilePath(), conclusionBackupsDirPath()),
    );

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
        knowledgeService: this.knowledgeService,
        worklogService: this.worklogService,
        conclusionService: this.conclusionService,
        mcpSource: resolveMcpSource(this.server.getClientVersion()),
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
