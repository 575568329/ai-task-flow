// shared/src/types/agent.ts
// 任务对话(Claude Code stream-json)透传事件类型 + 归一化后的会话结构。
// 松类型:Claude CLI 决定事件结构,前端按 type 分发渲染(assistant/user/result/init/error)。
// ChatTurn/ChatBlock 是前后端统一的对账形态:实时流归一化 与 历史会话回放 都产出它。

/** AgentRunner 透传的单个 stream-json 事件 */
export interface AgentEvent {
  /** 事件类型:assistant | user | result | system | error */
  type: string;
  /** system 子类型:init | hook_* | thinking_tokens(前端只认 init) */
  subtype?: string;
  [key: string]: unknown;
}

/** tool_use 的执行结果(关联 tool_use_id 回填) */
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
  /** user 轮的文本 */
  text?: string;
  /** assistant 轮的内容块序列(渲染顺序 = 到达顺序) */
  blocks?: ChatBlock[];
}

/** 历史会话摘要(列表项) */
export interface ChatSessionSummary {
  sessionId: string;
  title: string;
  lastActiveAt: string;
  messageCount: number;
  source?: 'windows' | 'wsl';
}
