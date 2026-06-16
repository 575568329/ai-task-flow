// backend/src/infrastructure/llm/AnthropicProvider.ts
import type { LlmProvider, LlmMessage, StreamChunk } from './LlmProvider.js';
import { FileLogger, maskSecret } from '../logging/FileLogger.js';

const logger = new FileLogger('llm');

/** 流式回答的最大输出 token */
const MAX_TOKENS_STREAM = 4096;
/** 结构化分类的最大输出 token */
const MAX_TOKENS_OBJECT = 2048;

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
}

/**
 * Anthropic 协议 provider:智谱 /api/anthropic(GLM Coding Plan,glm-5.2)、Claude 官方等。
 * 与 OpenAiCompatibleProvider 并存,由 LlmConfigService 根据 baseURL 含 /anthropic 自动选择。
 *
 * 与 OpenAI 协议的关键差异:
 * - 路径 /v1/messages(非 /chat/completions)
 * - 认证 Authorization: Bearer + anthropic-version 头
 * - system 提到顶层 system 字段(不混入 messages)
 * - 流式增量在 event: content_block_delta 的 delta.text
 */
export class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  /** 空 key 提前拦截,避免上游 401 被静默吞掉 */
  private assertConfigured(method: string): void {
    if (!this.apiKey || !this.apiKey.trim()) {
      logger.error(`${method}(anthropic) 调用被拒:apiKey 未配置`, { baseURL: this.baseURL, model: this.model });
      throw new Error('尚未配置 API Key,请先在「设置」中填写大模型 API Key 后重试');
    }
  }

  /** OpenAI 风格 messages → Anthropic payload:system 抽到顶层,dialog 只剩 user/assistant */
  private buildPayload(messages: LlmMessage[], stream: boolean, maxTokens: number): Record<string, unknown> {
    const systemParts: string[] = [];
    const dialog: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        dialog.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }
    }
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: dialog,
    };
    if (systemParts.length) body.system = systemParts.join('\n\n');
    if (stream) body.stream = true;
    return body;
  }

  async *streamText(messages: LlmMessage[]): AsyncIterable<StreamChunk> {
    this.assertConfigured('streamText');
    const url = `${this.baseURL}/v1/messages`;
    logger.info('streamText(anthropic) 请求', { url, model: this.model, apiKey: maskSecret(this.apiKey), messageCount: messages.length });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildPayload(messages, true, MAX_TOKENS_STREAM)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('streamText(anthropic) 上游错误', { status: response.status, body: errorText.slice(0, 500) });
      throw new Error(`LLM API failed: ${response.status} ${errorText.slice(0, 200)}`);
    }
    if (!response.body) throw new Error('No response body for streaming');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialChunk = '';
    let tokenCount = 0;
    let streamCompleted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        partialChunk += decoder.decode(value, { stream: true });

        // SSE 按 \n\n 分块;每块含 event:/data: 多行,只取 data: 行
        const blocks = partialChunk.split('\n\n');
        partialChunk = blocks.pop() || '';

        for (const block of blocks) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          try {
            const evt = JSON.parse(json);
            // 文本增量:content_block_delta 的 text_delta
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
              tokenCount += 1;
              yield { delta: evt.delta.text, done: false };
            }
          } catch {
            logger.warn('解析 anthropic SSE 失败', { raw: json.slice(0, 200) });
          }
        }
      }
      streamCompleted = true;
      logger.info('streamText(anthropic) 完成', { tokenChunks: tokenCount });
    } finally {
      // 仅正常读完才发 done,异常路径让错误如实冒泡(与 OpenAI provider 行为一致)
      if (streamCompleted) yield { delta: '', done: true };
    }
  }

  async generateObject<T>(messages: LlmMessage[], schema: any): Promise<T> {
    this.assertConfigured('generateObject');
    const url = `${this.baseURL}/v1/messages`;
    logger.info('generateObject(anthropic) 请求', { url, model: this.model, apiKey: maskSecret(this.apiKey), messageCount: messages.length });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildPayload(messages, false, MAX_TOKENS_OBJECT)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('generateObject(anthropic) 上游错误', { status: response.status, body: errorText.slice(0, 500) });
      throw new Error(`LLM API generateObject failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    // content 是 block 数组,拼出全部文本(通常单个 text block)
    const content = data.content?.map((b) => b.text).filter(Boolean).join('') ?? '';
    if (!content) {
      logger.error('generateObject(anthropic) 响应无 content', { data: JSON.stringify(data).slice(0, 500) });
      throw new Error('No content in generateObject response');
    }

    // Anthropic 无 response_format 强制 JSON,模型可能在 JSON 前后加文字 → 抽取首个 {...}
    const parsed = extractJsonObject(content);
    logger.info('generateObject(anthropic) 完成');
    return parsed as T;
  }
}

/** 从可能含说明文字的响应里抽取首个完整 {...} JSON 对象 */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`generateObject 响应不含 JSON: ${text.slice(0, 200)}`);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (err) {
          throw new Error(`generateObject JSON 解析失败: ${(err as Error).message}`);
        }
      }
    }
  }
  throw new Error(`generateObject 响应 JSON 不完整: ${text.slice(0, 200)}`);
}
