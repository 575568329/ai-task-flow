// frontend/src/api/projectChat.ts
// 项目对话(悬浮窗)客户端:聚合项目视图 + 加载历史 + 流式发消息(SSE)。
// 后端 POST /api/project-chat → SSE 透传 Claude stream-json 事件,前端按 type 分发。
import type { AgentEvent, ChatTurn, ImageAttachment, ProjectChatGroup } from '@ai-task-flow/shared';
import { API_BASE } from './base';
import { http } from './http';
import { streamAgentEvents } from './sse-utils';
import { loadRepoHistory } from '@/lib/repoHistory';

/** 拉取按项目聚合的对话视图(悬浮窗项目 tab + 对话列表)。
 *  extraPaths: 前端 repoHistory 中的额外项目路径,后端一并扫描 */
export function fetchProjectChats(extraPaths?: string[]) {
  const qs = extraPaths?.length
    ? `?extra=${extraPaths.map(encodeURIComponent).join(',')}`
    : '';
  return http.get<{ projects: ProjectChatGroup[] }>(`/project-chat/projects${qs}`);
}

/** 加载某历史会话的完整消息时间线(后端解析 jsonl → ChatTurn[]) */
export function loadProjectSession(repoPath: string, sessionId: string) {
  // repoPath 走 query string(避免依赖 http.get 的 query 形参约定,手动 encode 最稳)
  const qs = `?repoPath=${encodeURIComponent(repoPath)}`;
  return http.get<{ turns: ChatTurn[] }>(`/project-chat/sessions/${sessionId}${qs}`);
}

export interface StreamProjectChatOptions {
  repoPath: string;
  message: string;
  signal?: AbortSignal;
  /** 续接的历史会话 id;不传则后端新建会话 */
  sessionId?: string;
  /** 跑哪一侧的 claude:windows(默认)/ wsl */
  side?: 'windows' | 'wsl';
  /** 粘贴的图片(base64 数据 + MIME 类型) */
  images?: ImageAttachment[];
}

/**
 * 流式发起一轮项目对话(自由对话,不注入任务上下文)。
 * @returns async iterable,逐个产出 AgentEvent(后端 SSE data 行 parse 后的对象)
 */
export async function* streamProjectChat(
  options: StreamProjectChatOptions,
): AsyncIterable<AgentEvent> {
  const { repoPath, message, signal, sessionId, side, images } = options;
  const response = await fetch(`${API_BASE}/api/project-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, message, sessionId, side, images, extraPaths: loadRepoHistory() }),
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
