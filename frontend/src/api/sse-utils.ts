// frontend/src/api/sse-utils.ts
// 共享 SSE 帧解析工具 — 消除 projectChat / taskChat 的 parseFrame 重复
import type { AgentEvent } from '@ai-task-flow/shared';

/**
 * 解析单个 SSE "data: {...}" 帧为 AgentEvent。
 * 非 data 行或非 JSON 帧静默忽略（keep-alive 注释、空行等）。
 */
export function* parseAgentEventFrame(frame: string): Generator<AgentEvent> {
  const trimmed = frame.trim();
  if (!trimmed) return;
  const match = trimmed.match(/^data: (.+)$/s);
  if (!match) return;
  try {
    yield JSON.parse(match[1]) as AgentEvent;
  } catch {
    // 非 JSON 帧（keep-alive 注释等）忽略
  }
}

/**
 * 从 fetch Response body 读取 SSE 流，逐帧 parse 为 AgentEvent。
 * 流结束后处理 buffer 残留：后端若因异常/abort 退出，最后一帧可能没补 \n\n，
 * 不处理会丢 result 事件 → streaming 卡死、sessionId 不落盘、续接断链。
 */
export async function* streamAgentEvents(
  response: Response,
): AsyncIterable<AgentEvent> {
  if (!response.body) throw new Error('响应无 body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      yield* parseAgentEventFrame(frame);
    }
  }

  if (buffer.trim()) yield* parseAgentEventFrame(buffer);
}
