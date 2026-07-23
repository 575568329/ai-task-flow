// shared/src/types/claude-session.ts
// Claude Code 历史会话相关共享类型(前后端单一来源)

import type { TaskEnv } from './task.js';

/** 单个 Claude 历史会话的元信息(后端扫描 ~/.claude/projects 得出) */
export interface ClaudeSessionMeta {
  sessionId: string;       // 会话 id(jsonl 文件名, claude --resume 用)
  title: string;           // 首条 user 消息文本截断
  cwd: string;             // jsonl 内记录的真实工作目录
  lastActiveAt: string;    // ISO, 取文件 mtime
  messageCount: number;    // 消息条数(近似活跃度)
  source?: 'windows' | 'wsl';  // 会话来源:cwd 盘符路径→windows(原生 cmd/pwsh Claude),/mnt 或 / 开头→wsl(WSL 内 Claude)
}

/** GET /api/system/claude-sessions 响应 */
export interface ClaudeSessionListResponse {
  sessions: ClaudeSessionMeta[];
}

/** POST /api/system/claude-sessions/open 请求 */
export interface OpenClaudeRequest {
  repoPath: string;
  env: TaskEnv;
  sessionId?: string;      // 有则 resume, 无则新建
}

/** POST /api/system/claude-sessions/open 响应 */
export interface OpenClaudeResponse {
  ok: boolean;
  claudeCommand: string;   // 供前端写剪贴板
}
