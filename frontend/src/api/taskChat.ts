// frontend/src/api/taskChat.ts
// 任务对话流式客户端:POST /api/tasks/:id/chat → SSE(text/event-stream)逐事件 yield。
// 后端透传 Claude Code stream-json 事件(assistant/user/result/init/error),前端按 type 分发渲染。
import type { AgentEvent, ChatSessionSummary, ChatTurn } from '@ai-task-flow/shared';
import { API_BASE } from './base';
import { http } from './http';
import { streamAgentEvents } from './sse-utils';

/** 列出该任务仓库下的历史 Claude 会话(复用后端 ClaudeSessionScanner) */
export function listTaskChatSessions(taskId: string) {
  return http.get<{ sessions: ChatSessionSummary[] }>(`/tasks/${taskId}/chat/sessions`);
}

/** 加载某历史会话的完整消息时间线(后端解析 jsonl → ChatTurn[]) */
export function loadTaskChatSession(taskId: string, sessionId: string) {
  return http.get<{ turns: ChatTurn[] }>(`/tasks/${taskId}/chat/sessions/${sessionId}`);
}

/** 重命名会话(看板侧自定义标题,仅影响看板显示;不碰 Claude jsonl) */
export function renameTaskChatSession(taskId: string, sessionId: string, title: string) {
  return http.put<{ sessionId: string; title: string }>(
    `/tasks/${taskId}/chat/sessions/${sessionId}/title`,
    { title },
  );
}

/**
 * 流式发起一轮任务对话。
 * @returns async iterable,逐个产出 AgentEvent(后端 SSE data 行 parse 后的对象)
 */
export async function* streamTaskChat(
  taskId: string,
  message: string,
  signal?: AbortSignal,
  /** 续接的历史会话 id(加载历史后继续聊);不传则后端用上次 result 的 sessionId */
  sessionId?: string,
  /** 跑哪一侧的 claude:windows(默认)/ wsl */
  side?: 'windows' | 'wsl',
): AsyncIterable<AgentEvent> {
  const response = await fetch(`${API_BASE}/api/tasks/${taskId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, side }),
    signal, // abort 时 fetch 抛 AbortError,后端 request close → kill claude 子进程
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.error) detail = data.error;
    } catch {
      // 响应非 JSON,用默认消息
    }
    throw new Error(detail);
  }

  yield* streamAgentEvents(response);
}
