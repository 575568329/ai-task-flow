// backend/src/interfaces/mcp/tools/list-pending-tasks.ts
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import type { ToolDeps } from './types.js';

export const toolDef = {
  name: 'list_pending_tasks' as const,
  description: '列出待办任务',
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['todo', 'pending', 'all'],
        description: '筛选状态:todo=仅待办;pending=待办+进行中(默认);all=全部',
      },
    },
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const statusFilter = args?.status || 'pending';

  let tasks;
  if (statusFilter === 'all') {
    tasks = await deps.taskRepository.findAll();
  } else if (statusFilter === 'todo') {
    tasks = await deps.taskRepository.findByStatus(TaskStatus.TODO);
  } else {
    const [todo, inProgress] = await Promise.all([
      deps.taskRepository.findByStatus(TaskStatus.TODO),
      deps.taskRepository.findByStatus(TaskStatus.IN_PROGRESS),
    ]);
    tasks = [...todo, ...inProgress];
  }

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
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
