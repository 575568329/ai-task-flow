// frontend/src/api/chatStream.ts
import type { SSEEvent } from '@ai-task-flow/shared';

/**
 * SSE 流式客户端（POST 不能用 EventSource，手动读 ReadableStream）
 */
export async function* streamChat(params: {
  conversationId: string;
  message: string;
  useWebSearch: boolean;
}): AsyncIterable<SSEEvent> {
  const response = await fetch('/api/chat', { // 使用相对路径
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE: "data: {...}\n\n"
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      const match = line.match(/^data: (.+)$/);
      if (!match) continue;

      try {
        const event: SSEEvent = JSON.parse(match[1]);
        yield event;
      } catch (error) {
        console.warn('Failed to parse SSE event:', match[1], error);
      }
    }
  }
}
