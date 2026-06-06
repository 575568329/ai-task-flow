// backend/src/interfaces/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { container } from '../../infrastructure/di/container.js';
import type { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { TaskStatus } from '../../domain/workflow/value-objects/TaskStatus.js';
import { TaskId } from '../../domain/workflow/value-objects/TaskId.js';
import type { WorktreeManager } from '../../infrastructure/git/WorktreeManager.js';

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
  private taskRepository: TaskRepository;
  private worktreeManager: WorktreeManager;

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

    // 从 DI 容器获取依赖
    this.taskRepository = container.resolve<TaskRepository>('TaskRepository');
    this.worktreeManager = container.resolve<WorktreeManager>('WorktreeManager');

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
        {
          name: 'get_task_diff',
          description: '获取任务 worktree 的 git diff',
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
        case 'get_task_diff':
          return this.handleGetTaskDiff(args);
        case 'add_note_to_task':
          return this.handleAddNoteToTask(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleListPendingTasks(args: any) {
    const statusFilter = args?.status || 'todo';

    let tasks;
    if (statusFilter === 'all') {
      const todo = await this.taskRepository.findByStatus(TaskStatus.TODO);
      const dispatched = await this.taskRepository.findByStatus(TaskStatus.DISPATCHED);
      tasks = [...todo, ...dispatched];
    } else if (statusFilter === 'dispatched') {
      tasks = await this.taskRepository.findByStatus(TaskStatus.DISPATCHED);
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
      '',
      '## 描述',
      task.description || '（无描述）',
      '',
      '## 任务步骤',
    ];

    if (task.steps.length > 0) {
      task.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step.description}`);
        if (step.imageUrl) {
          lines.push(`   ![图片](${step.imageUrl})`);
        }
      });
    } else {
      lines.push('（无步骤）');
    }

    lines.push('');
    lines.push('## 相关文件');
    if (task.relatedFiles.length > 0) {
      task.relatedFiles.forEach(file => {
        lines.push(`- \`${file}\``);
      });
    } else {
      lines.push('（无相关文件）');
    }

    // Worktree 信息
    if (task.worktree) {
      lines.push('');
      lines.push('## Worktree 信息');
      lines.push(`- 路径: \`${task.worktree.path}\``);
      lines.push(`- 分支: \`${task.worktree.branch}\``);
      lines.push(`- Base Commit: \`${task.worktree.baseCommit.substring(0, 7)}\``);
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

    // 验证任务状态
    if (task.status !== TaskStatus.DISPATCHED) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 任务 ${taskId} 未派发，无法记录结果（当前状态: ${task.status}）`,
          },
        ],
      };
    }

    // 记录结果
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
              '任务已进入审核状态，请等待审核。',
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

  private async handleGetTaskDiff(args: any) {
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

    // 验证任务是否有 worktree
    if (!task.worktree) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 任务 ${taskId} 未派发，没有 worktree`,
          },
        ],
      };
    }

    // 获取 diff
    try {
      const diff = await this.worktreeManager.getDiff(task.worktree);

      return {
        content: [
          {
            type: 'text',
            text: [
              `# Diff for Task ${taskId}`,
              '',
              `**Worktree**: \`${task.worktree.path}\``,
              `**Branch**: \`${task.worktree.branch}\``,
              '',
              '```diff',
              diff || '(no changes)',
              '```',
            ].join('\n'),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 获取 diff 失败: ${error.message}`,
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

