// backend/src/config/dataDir.ts
// 数据根目录的单一解析来源。所有持久化(tasks.json / events.jsonl / uploads / tasks 存档)
// 都从这里取路径,避免 os.homedir() 散落在各处导致无法自定义。
//
// 解析优先级:
//   1. 显式传入(CLI --data-dir / startApp({ dataDir }))
//   2. 环境变量 AI_TASK_FLOW_DATA_DIR
//   3. 默认 ~/.ai-task-flow
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** 默认数据目录名(位于用户主目录下) */
const DEFAULT_DIR_NAME = '.ai-task-flow';

/** 环境变量名:覆盖数据根目录 */
export const DATA_DIR_ENV = 'AI_TASK_FLOW_DATA_DIR';

let resolvedRoot: string | undefined;

/**
 * 解析并缓存数据根目录的绝对路径。
 * @param explicit 显式指定的目录(优先级最高),通常来自 CLI 参数
 */
export function resolveDataDir(explicit?: string): string {
  if (explicit && explicit.trim()) {
    resolvedRoot = path.resolve(explicit.trim());
    return resolvedRoot;
  }
  if (resolvedRoot) return resolvedRoot;

  const fromEnv = process.env[DATA_DIR_ENV];
  if (fromEnv && fromEnv.trim()) {
    resolvedRoot = path.resolve(fromEnv.trim());
    return resolvedRoot;
  }

  resolvedRoot = path.join(os.homedir(), DEFAULT_DIR_NAME);
  return resolvedRoot;
}

/** tasks.json 路径 */
export function tasksFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'tasks.json');
}

/** events.jsonl 路径 */
export function eventsFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'events.jsonl');
}

/** chats.json 路径(调研聊天数据)。与 tasks.json 同级,统一走 resolveDataDir,
 *  避免 JsonChatRepository 自行拼 process.env.HOME 导致改数据目录时路径跑偏。 */
export function chatFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'chats.json');
}

/** 上传图片目录 */
export function uploadsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'uploads');
}

/** 任务 markdown 存档目录(派发时落盘,供 Claude Code 读取 + 用户存档) */
export function taskDocsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'tasks');
}

/** 单个任务 markdown 文件路径 */
export function taskDocPath(taskId: string, dataDir?: string): string {
  return path.join(taskDocsDirPath(dataDir), `${taskId}.md`);
}

/** 日志目录(后端运行日志,如聊天链路全量日志) */
export function logsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'logs');
}

/** 知识库目录(项目内,进 git,相对项目根) */
export function knowledgeDirPath(): string {
  // ESM 中获取当前文件路径: import.meta.url → file:///... → 绝对路径
  const currentFile = fileURLToPath(import.meta.url);
  // backend/src/config/dataDir.ts → 上 3 层到项目根
  const projectRoot = path.resolve(path.dirname(currentFile), '../../..');
  return path.join(projectRoot, 'knowledge-base');
}
