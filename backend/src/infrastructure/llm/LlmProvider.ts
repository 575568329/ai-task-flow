// backend/src/infrastructure/llm/LlmProvider.ts
import type { ClassificationResult } from '@ai-task-flow/shared';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

/**
 * LLM Provider 抽象接口
 * 支持 OpenAI 兼容 API (OpenAI/DeepSeek/Moonshot/GLM)
 */
export interface LlmProvider {
  /**
   * 流式生成文本
   * @yields 逐 token 增量
   */
  streamText(messages: LlmMessage[]): AsyncIterable<StreamChunk>;

  /**
   * 结构化输出（用于分类+改写）
   * 内部调用非流式 chat completions,解析 JSON 返回
   */
  generateObject<T>(messages: LlmMessage[], schema: any): Promise<T>;
}
