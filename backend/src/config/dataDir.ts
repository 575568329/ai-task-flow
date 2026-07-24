// backend/src/config/dataDir.ts
// 数据根目录的单一解析来源。所有持久化(tasks.json / events.jsonl / uploads / tasks 存档)
// 都从这里取路径,避免 os.homedir() 散落在各处导致无法自定义。
//
// 解析优先级:
//   1. 显式传入(CLI --data-dir / startApp({ dataDir }))
//   2. 环境变量 AI_TASK_FLOW_DATA_DIR
//   3. WSL 下探测 Windows 用户目录(代码兜底,不依赖 WSLENV)
//   4. 默认 ~/.ai-task-flow
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 默认数据目录名(位于用户主目录下) */
const DEFAULT_DIR_NAME = '.ai-task-flow';

/** 环境变量名:覆盖数据根目录 */
export const DATA_DIR_ENV = 'AI_TASK_FLOW_DATA_DIR';

let resolvedRoot: string | undefined;

/**
 * 是否运行在 WSL 内。后端常跑 Windows、MCP 常跑 WSL,需据此切换数据目录定位。
 */
const IS_WSL: boolean = (() => {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
})();

/**
 * WSL 下探测 Windows 用户目录并转成 WSL 路径(/mnt/c/Users/<user>),模块级缓存。
 *
 * 为什么需要:WSL 的 os.homedir() 是 /home/<user>,与 Windows 后端写的
 * C:\Users\<user>\.ai-task-flow 不是同一物理目录。WSLENV 桥接本可解决,但
 * Windows Terminal 启动 wsl.exe 时用进程级 WSLENV(传 WT_SESSION 等)覆盖了
 * 注册表里的 WSLENV,桥接变量进不来。故在代码侧直接探测,不依赖 WSLENV。
 */
let cachedWindowsHome: string | null | undefined; // undefined=未探测 / null=失败 / string=结果
function detectWindowsHome(): string | null {
  if (cachedWindowsHome !== undefined) return cachedWindowsHome;
  cachedWindowsHome = null;
  try {
    // appendWindowsPath=false 时 cmd.exe 不在 WSL PATH,用绝对路径
    const win = execFileSync('/mnt/c/Windows/System32/cmd.exe', ['/c', 'echo %USERPROFILE%'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (win) {
      // wslpath:C:\Users\<user> → /mnt/c/Users/<user>
      const wsl = execFileSync('wslpath', [win], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (wsl) cachedWindowsHome = wsl;
    }
  } catch {
    // 探测失败(非标准 WSL / cmd.exe 缺失):回退默认 home
  }
  return cachedWindowsHome;
}

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

  // WSL 兜底:不依赖 WSLENV(会被 Windows Terminal 覆盖),直接探测 Windows 用户目录,
  // 让 WSL 侧的 MCP 读到与 Windows 后端同一份数据。
  if (IS_WSL) {
    const winHome = detectWindowsHome();
    if (winHome) {
      resolvedRoot = path.join(winHome, DEFAULT_DIR_NAME);
      return resolvedRoot;
    }
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

/** vocab.json 路径(翻译生词本数据),与 chats.json 同级 */
export function vocabFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'vocab.json');
}

/** 上传图片目录 */
export function uploadsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'uploads');
}

let cachedWinUploads: string | null | undefined;
/**
 * uploads 目录的 Windows 路径形式(`wslpath -w` 转换,模块级缓存)。
 *
 * 用途:MCP get_task 给 Claude 两种本地路径——WSL 侧读 uploadsDirPath()(/mnt/c/...),
 * Windows 侧读本函数值(C:\\...)——按自身环境取用,无需访问后端 HTTP(localhost:5678 在
 * WSL 侧是死链)。非 WSL 或转换失败返回 null(此时无 Windows 形式可转,只给 WSL 路径)。
 */
export function uploadsDirWindowsPath(): string | null {
  if (cachedWinUploads !== undefined) return cachedWinUploads;
  if (!IS_WSL) {
    cachedWinUploads = null;
    return null;
  }
  try {
    cachedWinUploads = execFileSync('wslpath', ['-w', uploadsDirPath()], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    cachedWinUploads = null;
  }
  return cachedWinUploads;
}

/** 任务 markdown 存档目录(派发时落盘,供 Claude Code 读取 + 用户存档) */
export function taskDocsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'tasks');
}

/** 单个任务 markdown 文件路径 */
export function taskDocPath(taskId: string, dataDir?: string): string {
  return path.join(taskDocsDirPath(dataDir), `${taskId}.md`);
}

/** 任务对话 sessionId 存储( taskId → claude session_id,用于 --resume 续接) */
export function taskSessionsFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'task-sessions.json');
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
