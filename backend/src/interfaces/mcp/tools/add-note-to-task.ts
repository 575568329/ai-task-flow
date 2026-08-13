// backend/src/interfaces/mcp/tools/add-note-to-task.ts
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import type { ToolDeps } from './types.js';

export const toolDef = {
  name: 'add_note_to_task' as const,
  description: '为任务添加备注',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: '任务 ID（例如 WS-001）',
      },
      note: {
        type: 'string' as const,
        description: '备注内容',
      },
    },
    required: ['taskId', 'note'],
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const { taskId, note } = args;

  if (!taskId) {
    throw new Error('taskId is required');
  }
  if (!note) {
    throw new Error('note is required');
  }

  const task = await deps.taskRepository.findById(TaskId.fromString(taskId));

  if (!task) {
    return {
      content: [{ type: 'text' as const, text: `❌ 任务 ${taskId} 不存在` }],
    };
  }

  task.addNote(note);
  await deps.taskRepository.save(task);

  return {
    content: [{ type: 'text' as const, text: `✅ 已为任务 ${taskId} 添加备注` }],
  };
}
