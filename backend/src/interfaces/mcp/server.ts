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
import { TaskStatus } from '../../domain/workflow/value-objects/TaskStatus.js';
import { TaskId } from '../../domain/workflow/value-objects/TaskId.js';
import type { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { stepsToMarkdown } from '@ai-task-flow/shared';

/**
 * AI Task Flow MCP Server
 *
 * 提供给 Claude Code 的 MCP 工具：
 * - list_pending_tasks: 列出待办任务
 * - get_task: 获取任务详情
 * - record_result: 记录执行结果
 * - add_note_to_task: 添加备注
 */

class AITaskFlowServer {
  private server: Server;
  private taskRepository: TaskRepository;
  private knowledgeService: KnowledgeService;

  constructor() {
    this.server = new Server(
      {
        name: 'ai-task-flow',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // 从 DI 容器获取依赖
    this.taskRepository = container.resolve<TaskRepository>('TaskRepository');
    this.knowledgeService = container.resolve<KnowledgeService>('KnowledgeService');

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_pending_tasks',
          description: '列出待办任务',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['todo', 'all'],
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
        {
          name: 'add_note_to_task',
          description: '为任务添加备注',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: '任务 ID（例如 WS-001）',
              },
              note: {
                type: 'string',
                description: '备注内容',
              },
            },
            required: ['taskId', 'note'],
          },
        },
        {
          name: 'save_to_knowledge',
          description: '将调研结论/笔记写入知识库(创建新 Markdown 文档,文件名由服务端按命名规则生成,调用方无法干预物理文件名)',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '文档标题(用作文件名一部分,特殊字符会被清洗)',
              },
              content: {
                type: 'string',
                description: 'Markdown 正文',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: '可选标签(写入 frontmatter)',
              },
              dir: {
                type: 'string',
                description: '可选子目录(相对 knowledge-base/),不传则写根目录',
              },
            },
            required: ['title', 'content'],
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
        case 'add_note_to_task':
          return this.handleAddNoteToTask(args);
        case 'save_to_knowledge':
          return this.handleSaveToKnowledge(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // 列出知识库资源(供客户端按 uri 读取知识库 Markdown 文档)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const manifest = await this.knowledgeService.getManifest();
      const resources = manifest.flatDocs
        .filter(d => d.kind === 'md')
        .map(d => ({
          uri: `knowledge://${d.path}`,
          name: d.title,
          mimeType: 'text/markdown',
        }));
      return { resources };
    });

    // 读取单个知识库资源(knowledge://<相对路径>)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      if (!uri.startsWith('knowledge://')) {
        throw new Error(`Unsupported resource uri: ${uri}`);
      }
      const relPath = uri.replace('knowledge://', '');
      const doc = await this.knowledgeService.getDoc(relPath);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: doc.content ?? '',
          },
        ],
      };
    });
  }

  private async handleListPendingTasks(args: any) {
    const statusFilter = args?.status || 'todo';

    let tasks;
    if (statusFilter === 'all') {
      tasks = await this.taskRepository.findAll();
    } else {
      tasks = await this.taskRepository.findByStatus(TaskStatus.TODO);
    }

    // 格式化为 Markdown 表格
    const lines = [
      '# 待办任务列表',
      '',
      `共 ${tasks.length} 个任务`,
      '',
      '| ID | 标题 | 优先级 | 状态 | 项目 |',
      '|----|------|--------|------|------|',
    ];

    for (const task of tasks) {
      lines.push(
        `| ${task.id.value} | ${task.title} | ${task.priority} | ${task.status} | ${task.projectName || '-'} |`
      );
    }

    if (tasks.length === 0) {
      lines.push('| - | 暂无待办任务 | - | - | - |');
    }

    lines.push('');
    lines.push('**提示**: 使用 `get_task` 获取任务详情');

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  }

  private async handleGetTask(args: any) {
    const { taskId } = args;

    if (!taskId) {
      throw new Error('taskId is required');
    }

    const task = await this.taskRepository.findById(TaskId.fromString(taskId));

    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 任务 ${taskId} 不存在`,
          },
        ],
      };
    }

    // 拼装 Markdown 格式的任务详情
    const lines = [
      `# 任务详情: ${task.id.value}`,
      '',
      `**标题**: ${task.title}`,
      `**优先级**: ${task.priority}`,
      `**状态**: ${task.status}`,
      `**项目**: ${task.projectName || '无'}`,
      `**仓库路径**: ${task.repoPath || '无'}`,
    ];

    // 执行环境(会话化改造新增, 供 Claude Code 了解运行上下文)
    if (task.env) {
      lines.push(`**执行环境**: ${task.env}`);
    }

    lines.push('');
    lines.push('## 描述');
    lines.push(task.description || '（无描述）');
    lines.push('');
    lines.push('## 任务步骤');
    lines.push('');
    // 用 shared 统一生成步骤段(图文顺序 = 编辑器顺序);标题恒带 ☑/☐,
    // AI 能看到用户在看板上勾选了哪些步骤已完成(只读,不影响回写)。
    lines.push(stepsToMarkdown(task.steps, 3));

    lines.push('');
    lines.push('## 相关文件');
    if (task.relatedFiles.length > 0) {
      task.relatedFiles.forEach(file => {
        lines.push(`- \`${file}\``);
      });
    } else {
      lines.push('（无相关文件）');
    }

    // 执行结果
    if (task.executionResult) {
      lines.push('');
      lines.push('## 执行结果');
      lines.push(`- 状态: ${task.executionResult.status}`);
      lines.push(`- 变更文件: ${task.executionResult.changedFiles.join(', ')}`);
      lines.push(`- 备注: ${task.executionResult.notes}`);
    }

    lines.push('');
    lines.push('---');
    lines.push(`创建时间: ${task.createdAt.toISOString()}`);
    lines.push(`更新时间: ${task.updatedAt.toISOString()}`);

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  }

  private async handleRecordResult(args: any) {
    const { taskId, status, changedFiles, notes, reviewPoints, blockedReason } = args;

    if (!taskId) {
      throw new Error('taskId is required');
    }

    const task = await this.taskRepository.findById(TaskId.fromString(taskId));

    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 任务 ${taskId} 不存在`,
          },
        ],
      };
    }

    // 记录结果(会话化改造后不再要求 DISPATCHED:打开终端不改状态,TODO 也能直接回写)
    try {
      const resultEvent = task.recordResult({
        status,
        changedFiles,
        notes,
        reviewPoints,
        blockedReason,
      });

      await this.taskRepository.save(task);

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ 任务 ${taskId} 结果已记录`,
              '',
              `**状态**: ${status}`,
              `**变更文件**: ${changedFiles.length} 个`,
              `**备注**: ${notes}`,
              '',
              '任务状态已更新（done/partial → 已完成；blocked → 已阻塞）。',
            ].join('\n'),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 记录结果失败: ${error.message}`,
          },
        ],
      };
    }
  }

  private async handleAddNoteToTask(args: any) {
    const { taskId, note } = args;

    if (!taskId) {
      throw new Error('taskId is required');
    }

    if (!note) {
      throw new Error('note is required');
    }

    const task = await this.taskRepository.findById(TaskId.fromString(taskId));

    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 任务 ${taskId} 不存在`,
          },
        ],
      };
    }

    // 追加备注到描述中
    task.description = task.description + '\n\n---\n**备注**: ' + note;
    task.updatedAt = new Date();

    await this.taskRepository.save(task);

    return {
      content: [
        {
          type: 'text',
          text: `✅ 已为任务 ${taskId} 添加备注`,
        },
      ],
    };
  }

  private async handleSaveToKnowledge(args: any) {
    const { title, content, tags, dir } = args;

    if (!title || !title.trim()) {
      throw new Error('title is required');
    }
    if (!content) {
      throw new Error('content is required');
    }

    try {
      const result = await this.knowledgeService.createDoc({ title, content, tags, dir });
      return {
        content: [
          {
            type: 'text',
            text: [
              '✅ 已写入知识库',
              '',
              `**路径**: \`${result.path}\``,
              '',
              '文档已创建,前端知识库看板刷新即可见。',
            ].join('\n'),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 写入知识库失败: ${error.message}`,
          },
        ],
      };
    }
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

