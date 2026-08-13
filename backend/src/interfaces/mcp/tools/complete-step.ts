// backend/src/interfaces/mcp/tools/complete-step.ts
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import type { ToolDeps } from './types.js';

export const toolDef = {
  name: 'complete_step' as const,
  description:
    '标记任务的某个步骤完成/未完成,并按步骤完成度自动推进任务状态(全部完成→已完成,否则→进行中)。每完成一步调用一次。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: { type: 'string' as const, description: '任务 ID(例如 WS-001)' },
      stepNumber: {
        type: 'integer' as const,
        description: '步骤序号,从 1 开始(对应 get_task 显示的「步骤 1/2/3」)',
      },
      completed: {
        type: 'boolean' as const,
        description: 'true=标记完成(默认),false=取消完成',
      },
    },
    required: ['taskId', 'stepNumber'],
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const { taskId, stepNumber, completed } = args;

  if (!taskId) {
    throw new Error('taskId is required');
  }
  if (
    typeof stepNumber !== 'number' ||
    !Number.isInteger(stepNumber) ||
    stepNumber < 1
  ) {
    throw new Error('stepNumber is required (正整数, 1-based, 对应 get_task 的「步骤 N」)');
  }

  const stepIndex = stepNumber - 1;
  const task = await deps.taskRepository.findById(TaskId.fromString(taskId));

  if (!task) {
    return {
      content: [{ type: 'text' as const, text: `❌ 任务 ${taskId} 不存在` }],
    };
  }

  const completedVal = completed ?? true;
  try {
    task.setStepCompleted(stepIndex, completedVal);
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `❌ ${error.message}` }],
    };
  }

  await deps.taskRepository.save(task);

  const doneCount = task.steps.filter((s) => s.completed).length;
  return {
    content: [{
      type: 'text' as const,
      text: [
        `✅ 任务 ${taskId} 步骤 ${stepNumber} 已标记为${completedVal ? '完成' : '未完成'}`,
        `进度: ${doneCount}/${task.steps.length}`,
        `任务状态: ${task.status}`,
      ].join('\n'),
    }],
  };
}
