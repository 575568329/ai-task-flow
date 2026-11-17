// shared/src/types/claude-session.ts
// Claude Code 历史会话相关共享类型(前后端单一来源)


/** 单个 Claude 历史会话的元信息(后端扫描 ~/.claude/projects 得出) */
export interface ClaudeSessionMeta {
  sessionId: string;       // 会话 id(jsonl 文件名, claude --resume 用)
  title: string;           // 首条 user 消息文本截断
  cwd: string;             // jsonl 内记录的真实工作目录
  lastActiveAt: string;    // ISO, 取文件 mtime
  messageCount: number;    // 消息条数(近似活跃度)
  source?: 'windows' | 'wsl';  // 会话来源:cwd 盘符路径→windows(原生 cmd/pwsh Claude),/mnt 或 / 开头→wsl(WSL 内 Claude)
  /** 会话 Token 用量(扫 jsonl 行级 message.usage 累加);无 assistant 消息的空会话为空总量 */
  usage?: SessionUsage;
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
  /** 夜间模式:启动交互式 claude 时拼 --permission-mode bypassPermissions,跳过所有权限确认。
   *  仅限可信隔离环境(本机 worktree),默认关闭。前端从 uiStore.nightMode 透传。 */
  bypassPermissions?: boolean;
}

/** POST /api/system/claude-sessions/open 响应 */
export interface OpenClaudeResponse {
  ok: boolean;
  claudeCommand: string;   // 供前端写剪贴板
}

// ---------------------------------------------------------------------------
// 以下类型原分散于 types/task.ts / types/usage.ts / types/agent.ts,
// worklog 转型砍除任务/聊天链路后由本文件(Claude 会话扫描链的唯一保留消费者)承接。
// ---------------------------------------------------------------------------

/** 终端环境(claude 启动 shell 形态) */
export type TaskEnv = 'cmd' | 'wsl' | 'pwsh';

export interface TokenUsage {
  inputTokens: number;           // 普通输入(非缓存)
  outputTokens: number;          // 输出
  cacheCreation5mTokens: number; // 5min 缓存写入(计费 1.25×)
  cacheCreation1hTokens: number; // 1h 缓存写入(计费 2×)
  cacheReadTokens: number;       // 缓存命中读取(计费 0.1×)
}

/** 单模型累加块(TokenUsage + 该模型的 assistant 消息数,供精确 requestCount) */
export interface ModelAccum extends TokenUsage {
  requests: number;
}

/** 单个 Claude 会话(jsonl)按模型累加的用量 */
export interface SessionUsage {
  byModel: Record<string, ModelAccum>;
  byDay: Record<string, Record<string, ModelAccum>>;
  total: TokenUsage;
  assistantCount: number;
  taskId?: string;
}

export interface ChatToolResult {
  content: string;
  isError: boolean;
}

/** assistant 回复中的一个内容块 */
export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | {
      kind: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      result?: ChatToolResult;
    };

/** 一轮对话(用户消息 / assistant 回复) */
export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  images?: string[];
  blocks?: ChatBlock[];
  createdAt?: number;
}
