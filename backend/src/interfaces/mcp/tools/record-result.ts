// backend/src/interfaces/mcp/tools/record-result.ts
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { ExecutionResult } from '../../../domain/workflow/value-objects/ExecutionResult.js';
import type { ToolDeps } from './types.js';

export const toolDef = {
  name: 'record_result' as const,
  description: '记录任务执行结果',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: { type: 'string' as const },
      status: {
        type: 'string' as const,
        enum: ['done', 'partial', 'blocked'],
      },
      changedFiles: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      notes: { type: 'string' as const },
      reviewPoints: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      blockedReason: { type: 'string' as const },
    },
    required: ['taskId', 'status', 'changedFiles', 'notes'],
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const { taskId, status, changedFiles, notes, reviewPoints, blockedReason } = args;

  if (!taskId) {
    throw new Error('taskId is required');
  }

  const task = await deps.taskRepository.findById(TaskId.fromString(taskId));

  if (!task) {
    return {
      content: [{ type: 'text' as const, text: `❌ 任务 ${taskId} 不存在` }],
    };
  }

  try {
    const executionResult = new ExecutionResult(status, changedFiles, notes, reviewPoints, blockedReason);
    task.recordResult(executionResult);
    await deps.taskRepository.save(task);

    return {
      content: [{
        type: 'text' as const,
        text: [
          `✅ 任务 ${taskId} 结果已记录`,
          '',
          `**状态**: ${status}`,
          `**变更文件**: ${changedFiles.length} 个`,
          `**备注**: ${notes}`,
          '',
          '任务状态已更新（done/partial → 已完成；blocked → 已阻塞）。',
        ].join('\n'),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `❌ 记录结果失败: ${error.message}` }],
    };
  }
}
