// backend/src/infrastructure/persistence/taskDoc.ts
// 任务 Markdown 存档:派发/创建/更新时把任务内容落盘为 {dataDir}/tasks/{id}.md。
//
// 目的:
//   1. 用户存档需求——每个任务有一份可读、可版本化的 md 快照
//   2. Claude Code 派发指令直接指向真实存在的文件,不再是凭空拼的路径
//
// 单一来源:buildTaskMarkdown 同时供 GET /markdown 端点和文件写入复用,
// 保证"接口返回的 md" === "落盘的 md"。
import fs from 'node:fs/promises';
import path from 'node:path';
import { stepsToMarkdown } from '@ai-task-flow/shared';
import { Task } from '../../domain/workflow/entities/Task.js';
import { taskDocPath, taskDocsDirPath } from '../../config/dataDir.js';

/** 把任务渲染为完整 Markdown 文本(供存档与接口共用) */
export function buildTaskMarkdown(task: Task): string {
  const lines = [
    `# ${task.title}`,
    '',
    `**任务ID**: ${task.id.value}`,
    `**优先级**: ${task.priority}`,
    `**状态**: ${task.status}`,
  ];

  if (task.projectName) lines.push(`**项目**: ${task.projectName}`);
  if (task.repoPath) lines.push(`**仓库路径**: \`${task.repoPath}\``);

  lines.push('', '## 描述', '', task.description || '（无描述）', '');

  if (task.steps.length > 0) {
    lines.push('## 任务步骤', '');
    lines.push(stepsToMarkdown(task.steps), '');
  }

  if (task.relatedFiles.length > 0) {
    lines.push('## 相关文件', '');
    task.relatedFiles.forEach((file) => lines.push(`- \`${file}\``));
    lines.push('');
  }

  if (task.worktree) {
    lines.push(
      '## Worktree 信息',
      '',
      `- **路径**: \`${task.worktree.path}\``,
      `- **分支**: \`${task.worktree.branch}\``,
      `- **基准提交**: \`${task.worktree.baseCommit}\``,
      ''
    );
  }

  if (task.executionResult) {
    lines.push('## 执行结果', '', `**状态**: ${task.executionResult.status}`, '', '**变更文件**:', '');
    task.executionResult.changedFiles.forEach((file) => lines.push(`- \`${file}\``));
    lines.push('', `**备注**: ${task.executionResult.notes}`, '');
  }

  return lines.join('\n');
}

/**
 * 把任务 markdown 落盘到 {dataDir}/tasks/{id}.md,返回文件绝对路径。
 * 写入失败抛错由调用方决定是否忽略(存档失败不应阻断主流程)。
 */
export async function writeTaskDoc(task: Task): Promise<string> {
  const filePath = taskDocPath(task.id.value);
  await fs.mkdir(taskDocsDirPath(), { recursive: true });
  await fs.writeFile(filePath, buildTaskMarkdown(task), 'utf-8');
  return filePath;
}

/** 删除任务 markdown 存档(任务被删除时调用),文件不存在则静默忽略 */
export async function removeTaskDoc(taskId: string): Promise<void> {
  try {
    await fs.unlink(taskDocPath(taskId));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
}

