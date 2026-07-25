// frontend/src/api/projectChat.ts
// 项目对话(悬浮窗)客户端:聚合项目视图 + 加载历史 + 流式发消息(SSE)。
// 后端 POST /api/project-chat → SSE 透传 Claude stream-json 事件,前端按 type 分发。
// SSE 帧解析模式同 taskChat(第二步可抽共享 sse 解析,消除重复)。
import type { AgentEvent, ChatTurn, ProjectChatGroup } from '@ai-task-flow/shared';
import { http } from './http';

/** 拉取按项目聚合的对话视图(悬浮窗项目 tab + 对话列表) */
export function fetchProjectChats() {
  return http.get<{ projects: ProjectChatGroup[] }>('/project-chat/projects');
}

/** 加载某历史会话的完整消息时间线(后端解析 jsonl → ChatTurn[]) */
export function loadProjectSession(repoPath: string, sessionId: string) {
  // repoPath 走 query string(避免依赖 http.get 的 query 形参约定,手动 encode 最稳)
  const qs = `?repoPath=${encodeURIComponent(repoPath)}`;
  return http.get<{ turns: ChatTurn[] }>(`/project-chat/sessions/${sessionId}${qs}`);
}

/**
 * 流式发起一轮项目对话(自由对话,不注入任务上下文)。
 * @returns async iterable,逐个产出 AgentEvent(后端 SSE data 行 parse 后的对象)
 */
export async function* streamProjectChat(
  repoPath: string,
  message: string,
  signal?: AbortSignal,
  /** 续接的历史会话 id;不传则后端新建会话 */
  sessionId?: string,
  /** 跑哪一侧的 claude:windows(默认)/ wsl */
  side?: 'windows' | 'wsl',
): AsyncIterable<AgentEvent> {
  const response = await fetch('/api/project-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, message, sessionId, side }),
    signal, // abort 时 fetch 抛 AbortError,后端 request close → kill claude 子进程
  });

  if (!response.ok) {
    // 非流式错误(400/500 等):后端返回 JSON { error }
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
