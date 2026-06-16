// backend/src/infrastructure/llm/OpenAiCompatibleProvider.ts
import type { LlmProvider, LlmMessage, StreamChunk } from './LlmProvider.js';
import { FileLogger, maskSecret } from '../logging/FileLogger.js';

interface OpenAIChatCompletionChoice {
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface OpenAIChatCompletionChunk {
  choices: OpenAIChatCompletionChoice[];
}

const logger = new FileLogger('llm');

/**
 * OpenAI 兼容 provider: OpenAI / DeepSeek / Moonshot / GLM 的 chat completions API
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  /** 空 key 提前拦截:抛友好错误,避免等到上游 401 又被静默吞掉 */
  private assertConfigured(method: string): void {
    if (!this.apiKey || !this.apiKey.trim()) {
      logger.error(`${method} 调用被拒:apiKey 未配置`, { baseURL: this.baseURL, model: this.model });
      throw new Error('尚未配置 API Key,请先在「设置」中填写大模型 API Key 后重试');
    }
  }

  async *streamText(messages: LlmMessage[]): AsyncIterable<StreamChunk> {
    this.assertConfigured('streamText');

    const url = `${this.baseURL}/chat/completions`;
    logger.info('streamText 请求', {
      url,
      model: this.model,
      apiKey: maskSecret(this.apiKey),
      messageCount: messages.length,
    });

    const response = await fetch(url, {
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
      logger.error('streamText 上游返回错误', { status: response.status, body: errorText.slice(0, 500) });
      throw new Error(`LLM API failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      logger.error('streamText 无响应体');
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialChunk = '';
    let tokenCount = 0;
    // 标记是否正常读完流;异常路径下不发 done,让错误如实抛给消费方
    let streamCompleted = false;

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
              tokenCount += 1;
              yield { delta, done: false };
            }
          } catch (err) {
            logger.warn('解析 SSE chunk 失败', { raw: match[1].slice(0, 200) });
          }
        }
      }
      streamCompleted = true;
      logger.info('streamText 完成', { tokenChunks: tokenCount });
    } finally {
      // 关键修复:仅在正常读完时才发 done。
      // 旧实现无条件 yield done,会在异常(如 401 throw)时先发 done,
      // 导致消费方 `if (done) break` 跳出循环、异常被吞,前端看到"空回答"。
      if (streamCompleted) {
        yield { delta: '', done: true };
      }
    }
  }

  async generateObject<T>(messages: LlmMessage[], schema: any): Promise<T> {
    this.assertConfigured('generateObject');

    const url = `${this.baseURL}/chat/completions`;
    logger.info('generateObject 请求', {
      url,
      model: this.model,
      apiKey: maskSecret(this.apiKey),
      messageCount: messages.length,
    });

    const response = await fetch(url, {
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
      logger.error('generateObject 上游返回错误', { status: response.status, body: errorText.slice(0, 500) });
      throw new Error(`LLM API generateObject failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      logger.error('generateObject 响应无 content', { data: JSON.stringify(data).slice(0, 500) });
      throw new Error('No content in generateObject response');
    }

    const parsed = JSON.parse(content);
    logger.info('generateObject 完成');
    // TODO: 用 zod schema 校验,MVP 先直接返回
    return parsed as T;
  }
}
