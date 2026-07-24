// frontend/src/api/taskChat.ts
// 任务对话流式客户端:POST /api/tasks/:id/chat → SSE(text/event-stream)逐事件 yield。
// 后端透传 Claude Code stream-json 事件(assistant/user/result/init/error),前端按 type 分发渲染。
import type { AgentEvent, ChatSessionSummary, ChatTurn } from '@ai-task-flow/shared';
import { http } from './http';

/** 列出该任务仓库下的历史 Claude 会话(复用后端 ClaudeSessionScanner) */
export function listTaskChatSessions(taskId: string) {
  return http.get<{ sessions: ChatSessionSummary[] }>(`/tasks/${taskId}/chat/sessions`);
}

/** 加载某历史会话的完整消息时间线(后端解析 jsonl → ChatTurn[]) */
export function loadTaskChatSession(taskId: string, sessionId: string) {
  return http.get<{ turns: ChatTurn[] }>(`/tasks/${taskId}/chat/sessions/${sessionId}`);
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
  const response = await fetch(`/api/tasks/${taskId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, side }),
    signal, // abort 时 fetch 抛 AbortError,后端 request close → kill claude 子进程
  });

  if (!response.ok) {
    // 非流式错误(404/400 等):后端返回 JSON { error }
    let detail = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.error) detail = data.error;
    } catch {
      // 响应非 JSON,用默认消息
    }
    throw new Error(detail);
  }
  if (!response.body) throw new Error('响应无 body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 帧:"data: {...}\n\n"
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      yield* parseFrame(frame);
    }
  }
  // 流结束后处理 buffer 残留:后端若因异常/abort 退出,最后一帧可能没补 \n\n,
  // 不处理会丢 result 事件 → streaming 卡死、sessionId 不落盘、续接断链。
  if (buffer.trim()) yield* parseFrame(buffer);
}

/** 解析单个 SSE 帧,产出其中的 AgentEvent(非 data 行 / 非 JSON 静默忽略) */
function* parseFrame(frame: string): Generator<AgentEvent> {
  const trimmed = frame.trim();
  if (!trimmed) return;
  const match = trimmed.match(/^data: (.+)$/s);
  if (!match) return;
  try {
    yield JSON.parse(match[1]) as AgentEvent;
  } catch {
    // 非 JSON 帧(keep-alive 注释等)忽略
  }
}
