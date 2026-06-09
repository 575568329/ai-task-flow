// backend/src/infrastructure/llm/OpenAiCompatibleProvider.ts
import type { LlmProvider, LlmMessage, StreamChunk } from './LlmProvider.js';

interface OpenAIChatCompletionChoice {
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface OpenAIChatCompletionChunk {
  choices: OpenAIChatCompletionChoice[];
}

/**
 * OpenAI 兼容 provider: OpenAI / DeepSeek / Moonshot / GLM 的 chat completions API
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async *streamText(messages: LlmMessage[]): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialChunk = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partialChunk += decoder.decode(value, { stream: true });

        // 简单解析 SSE: "data: {...}\n\n"
        const lines = partialChunk.split('\n\n');
        partialChunk = lines.pop() || ''; // 保留最后一个不完整块

        for (const line of lines) {
          if (!line.trim() || line === 'data: [DONE]') continue;

          const match = line.match(/^data: (.+)$/);
          if (!match) continue;

          try {
            const chunk: OpenAIChatCompletionChunk = JSON.parse(match[1]);
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              yield { delta, done: false };
            }
          } catch (err) {
            console.warn('Failed to parse SSE chunk:', match[1], err);
          }
        }
      }
    } finally {
      yield { delta: '', done: true };
    }
  }

  async generateObject<T>(messages: LlmMessage[], schema: any): Promise<T> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API generateObject failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in generateObject response');
    }

    const parsed = JSON.parse(content);
    // TODO: 用 zod schema 校验,MVP 先直接返回
    return parsed as T;
  }
}
