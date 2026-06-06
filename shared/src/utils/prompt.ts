// shared/src/utils/prompt.ts
// 生成给 Claude Code 的"派发指令"——用户在看板上一键复制、粘贴到 Claude Code 即可开工。
//
// 设计原则:
// - 直接指向任务 markdown 文件路径，Claude 读取后执行
// - 使用绝对路径，方便 agent 直接定位
// - 简洁清晰，一句话说明任务目标和文件位置

import type { TaskDTO } from '../types/task.js';

/**
 * 给 Claude Code 的派发指令文本（纯文本，可直接复制粘贴）。
 *
 * @param task 任务 DTO（HTTP/MCP 返回的标准结构）
 */
export function buildClaudeCodePrompt(task: TaskDTO): string {
  const { id, title, repoPath } = task;

  // 优先使用项目路径下的 .ai-task-flow/tasks/ 目录（绝对路径）
  // 如果没有项目路径，回退到相对表示（但提示用户需要在项目目录下执行）
  let taskFilePath: string;
  if (repoPath) {
    // Windows 路径使用反斜杠，统一转换为正斜杠方便跨平台
    const normalizedPath = repoPath.replace(/\\/g, '/');
    taskFilePath = `${normalizedPath}/.ai-task-flow/tasks/${id}.md`;
  } else {
    // 无项目路径时，使用当前工作目录
    taskFilePath = `.ai-task-flow/tasks/${id}.md`;
  }

  return `请按照文件执行任务。路径: ${taskFilePath}

任务: [${id}] ${title}`;
}
