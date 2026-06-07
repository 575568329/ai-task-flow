// shared/src/utils/prompt.ts
// 生成给 Claude Code 的"派发指令"——用户在看板上一键复制、粘贴到 Claude Code 即可开工。
//
// 设计原则:
// - 直接指向任务 markdown 文件路径，Claude 读取后执行
// - 路径来自后端真实落盘的 taskFilePath（绝对路径），保证文件确实存在
// - 简洁清晰，一句话说明任务目标和文件位置

import type { TaskDTO } from '../types/task.js';

/**
 * 给 Claude Code 的派发指令文本（纯文本，可直接复制粘贴）。
 *
 * @param task 任务 DTO（HTTP/MCP 返回的标准结构）
 */
export function buildClaudeCodePrompt(task: TaskDTO): string {
  const { id, title, taskFilePath, repoPath } = task;

  // 优先用后端落盘的真实 markdown 路径（绝对路径，确保 agent 能直接读到）。
  // 回退：旧数据或未派发场景没有 taskFilePath 时，按数据目录约定拼一个提示路径。
  let filePath: string;
  if (taskFilePath) {
    filePath = taskFilePath.replace(/\\/g, '/');
  } else if (repoPath) {
    filePath = `${repoPath.replace(/\\/g, '/')}/.ai-task-flow/tasks/${id}.md`;
  } else {
    filePath = `.ai-task-flow/tasks/${id}.md`;
  }

  return `请按照文件执行任务。路径: ${filePath}

任务: [${id}] ${title}`;
}
