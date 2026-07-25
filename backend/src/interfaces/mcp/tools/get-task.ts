// backend/src/interfaces/mcp/tools/get-task.ts
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import path from 'node:path';
import { stepsToMarkdown } from '@ai-task-flow/shared';
import { uploadsDirPath, uploadsDirWindowsPath } from '../../../config/dataDir.js';
import type { ToolDeps } from './types.js';

/** 匹配 markdown 图片语法 ![alt](url) */
const UPLOAD_URL_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
/** 从 url 提取 uploads 文件名 */
const UPLOADS_ROUTE_RE = /\/api\/uploads\/([^/?#]+)$/;

function extractUploadFilename(url: string): string | null {
  const m = UPLOADS_ROUTE_RE.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

export const toolDef = {
  name: 'get_task' as const,
  description: '获取任务详情（含 Markdown 格式化）',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: '任务 ID（例如 WS-001）',
      },
    },
    required: ['taskId'],
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const { taskId } = args;

  if (!taskId) {
    throw new Error('taskId is required');
  }

  const task = await deps.taskRepository.findById(TaskId.fromString(taskId));

  if (!task) {
    return {
      content: [{ type: 'text' as const, text: `❌ 任务 ${taskId} 不存在` }],
    };
  }

  const lines = [
    `# 任务详情: ${task.id.value}`,
    '',
    `**标题**: ${task.title}`,
    `**优先级**: ${task.priority}`,
    `**状态**: ${task.status}`,
    `**项目**: ${task.projectName || '无'}`,
    `**仓库路径**: ${task.repoPath || '无'}`,
  ];

  if (task.env) {
    lines.push(`**执行环境**: ${task.env}`);
  }

  lines.push('');
  lines.push('## 描述');
  lines.push(task.description || '（无描述）');
  lines.push('');
  lines.push('## 任务步骤');
  lines.push('');
  lines.push(stepsToMarkdown(task.steps, 3));

  lines.push('');
  lines.push('## 相关文件');
  if (task.relatedFiles.length > 0) {
    task.relatedFiles.forEach(file => lines.push(`- \`${file}\``));
  } else {
    lines.push('（无相关文件）');
  }

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

  // 任务标记（HTML 注释,供 ClaudeSessionScanner 关联用量）
  let markdown = `<!-- ai-task-flow: task=${task.id.value} -->\n` + lines.join('\n');

  // 图片 URL → 本地双路径 (WSL + Windows)
  const wslUploads = uploadsDirPath();
  const winUploads = uploadsDirWindowsPath();
  const ranges: Array<{ start: number; end: number; label: string }> = [];
  let imgIdx = 0;
  for (const m of markdown.matchAll(UPLOAD_URL_RE)) {
    const filename = extractUploadFilename(m[1]);
    if (!filename) continue;
    imgIdx += 1;
    const start = m.index ?? 0;
    const labelLines = [
      `（截图 ${imgIdx}:按你的环境用 Read 读取本地文件)`,
      `  - WSL: \`${path.posix.join(wslUploads, filename)}\``,
    ];
    if (winUploads) {
      labelLines.push(`  - Windows: \`${path.win32.join(winUploads, filename)}\``);
    }
    ranges.push({ start, end: start + m[0].length, label: labelLines.join('\n') });
  }
  ranges.sort((a, b) => b.start - a.start);
  for (const r of ranges) {
    markdown = markdown.slice(0, r.start) + r.label + markdown.slice(r.end);
  }

  return {
    content: [{ type: 'text' as const, text: markdown }],
  };
}
