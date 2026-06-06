// shared/src/utils/prompt.ts
// 生成给 Claude Code 的"派发指令"——用户在看板上一键复制、粘贴到 Claude Code 即可开工。
//
// 设计原则:
// - 数据从 MCP 工具实时拉,不嵌入静态副本(任务可能被改)
// - 引导 Claude 走完整闭环:拉取 → 实施 → 回写
// - 根据任务状态自适应文案(未派发要先派发、review 是打回返工等)

import type { TaskDTO } from '../types/task.js';

/**
 * 给 Claude Code 的派发指令文本（纯文本，可直接复制粘贴）。
 *
 * @param task 任务 DTO（HTTP/MCP 返回的标准结构）
 */
export function buildClaudeCodePrompt(task: TaskDTO): string {
  const { id, title, priority, projectName, status } = task;

  const lines: string[] = [
    `请按 AI Task Flow 流程协助完成任务 [${id}] ${title}`,
    '',
    '执行步骤:',
    `1. 调用 MCP 工具 \`get_task(taskId: "${id}")\` 拉取完整需求(描述、步骤、相关文件、worktree 路径)`,
    '2. 进入返回的 worktree 目录,按步骤实施,严格遵循项目 `.claude/CLAUDE.md` 中的开发规范',
    `3. 完成后调用 \`record_result(taskId: "${id}", status, changedFiles, notes)\` 回写结果,触发看板审核`,
    '',
  ];

  // 状态相关的提示
  const statusHint = buildStatusHint(status);
  if (statusHint) {
    lines.push(statusHint, '');
  }

  // 末尾元信息（一行紧凑显示）
  const meta = [`优先级 ${priority}`];
  if (projectName) meta.push(`项目 ${projectName}`);
  lines.push(meta.join(' · '));

  return lines.join('\n');
}

/** 根据任务状态给 Claude 不同的提示 */
function buildStatusHint(status: TaskDTO['status']): string | null {
  switch (status) {
    case 'todo':
      return '⚠️ 此任务尚未派发,worktree 还没创建。请提醒我先在看板点击「派发」按钮,再开始工作。';
    case 'dispatched':
      return null; // 标准流程,不需要额外提示
    case 'review':
      return 'ℹ️ 此任务已在审核中。如果是被打回返工,请根据看板上的打回理由调整后再次回写结果。';
    case 'blocked':
      return 'ℹ️ 此任务被标记为阻塞。请先 `get_task` 查看 blockedReason,评估是否能解除阻塞。';
    case 'done':
      return 'ℹ️ 此任务已完成。如需进一步修改请创建新任务,或在看板上重新打开。';
    case 'planning':
      return '⚠️ 此任务还在规划阶段,需求可能不完整。请先确认需求清晰后再派发。';
    default:
      return null;
  }
}
