// backend/src/application/research/ChatService.ts
import type { ChatRepository } from '../../domain/research/repositories/ChatRepository.js';
import { ChatMessage } from '../../domain/research/entities/ChatMessage.js';
import type { LlmProvider, LlmMessage } from '../../infrastructure/llm/LlmProvider.js';
import { ClassifierService } from './ClassifierService.js';
import { SearchOrchestrator } from './SearchOrchestrator.js';
import type { SSEEvent, Source } from '@ai-task-flow/shared';

export interface ChatRequest {
  conversationId: string;
  message: string;
  useWebSearch: boolean;
}

/**
 * 聊天服务（主编排）
 * 流程（抄 Perplexica search/index.ts）：
 * 1. 分类+改写
 * 2. 检索（可选）
 * 3. RAG + 流式生成
 * 4. 引用校验 + 持久化
 */
export class ChatService {
  private classifier: ClassifierService;

  constructor(
    private readonly repository: ChatRepository,
    private readonly llm: LlmProvider,
    private readonly searchOrchestrator: SearchOrchestrator,
  ) {
    this.classifier = new ClassifierService(llm);
  }

  async *handleChat(request: ChatRequest): AsyncIterable<SSEEvent> {
    const { conversationId, message, useWebSearch } = request;

    // 1. 持久化用户消息
    const userMsg = ChatMessage.createUser(conversationId, message);
    await this.repository.saveMessage(userMsg);

    // 2. 获取历史（用于分类和 RAG）
    const history = await this.repository.findMessagesByConversationId(conversationId);
    const historyForLLM: LlmMessage[] = history
      .slice(-10) // 最近 10 轮
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    // 3. 分类+改写
    yield {
      type: 'progress',
      content: 'classifying',
      output: '🔍 正在理解问题…',
    };

    let sources: Source[] = [];

    if (useWebSearch) {
      const classification = await this.classifier.classify(message, historyForLLM);

      yield {
        type: 'progress',
        content: 'rewritten',
        output: `检索词：${classification.searchQueries.join('、')}`,
      };

      // 4. 检索（可选）
      if (!classification.skipSearch) {
        yield {
          type: 'progress',
          content: 'searching',
          output: '⟳ 正在检索资料…',
          metadata: classification.searchQueries,
        };

        sources = await this.searchOrchestrator.search(classification);

        if (sources.length > 0) {
          yield {
            type: 'progress',
            content: 'found',
            output: `✓ 找到 ${sources.length} 篇高相关来源`,
          };

          yield {
            type: 'source',
            sources,
          };
        } else {
          yield {
            type: 'progress',
            content: 'no_results',
            output: 'ℹ️ 未检索到资料，以下为模型已有知识',
          };
        }
      }
    }

    // 5. 构造 RAG messages（抄 Perplexica writer.ts）
    const systemPrompt = this.buildWriterPrompt(sources);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyForLLM,
      { role: 'user', content: message },
    ];

    // 6. 流式生成
    let assistantContent = '';
    for await (const chunk of this.llm.streamText(messages)) {
      if (chunk.done) break;

      assistantContent += chunk.delta;
      yield {
        type: 'text-delta',
        delta: chunk.delta,
      };
    }

    // 7. 引用编号合法性校验（剥除越界 [n]）
    const validatedContent = this.validateCitations(assistantContent, sources);

    // 8. 持久化 assistant 消息
    const assistantMsg = ChatMessage.createAssistant(conversationId, validatedContent, sources);
    await this.repository.saveMessage(assistantMsg);

    // 9. done
    yield {
      type: 'done',
      messageId: assistantMsg.id,
      sources,
    };
  }

  private buildWriterPrompt(sources: Source[]): string {
    // 抄 Perplexica writer.ts 引用要求
    let prompt = `You are a research assistant. Provide detailed, well-structured answers.

**Citation Requirements**:
- Cite every fact using [number] notation
- Use [1][2] for multiple sources
- If no source supports a statement, clearly indicate the limitation

`;

    if (sources.length > 0) {
      prompt += `<context>\n`;
      sources.forEach(s => {
        prompt += `[${s.index}] ${s.title}\n${s.snippet}\nURL: ${s.url}\n\n`;
      });
      prompt += `</context>\n\nUse the above context to answer. Cite sources with [n].`;
    } else {
      prompt += `No external sources provided. Answer based on your knowledge and clearly state limitations.`;
    }

    return prompt;
  }

  private validateCitations(content: string, sources: Source[]): string {
    // 剥除越界引用编号（抄 Perplexica useChat.tsx citationRegex）
    const citationRegex = /\[(\d+)\]/g;
    return content.replace(citationRegex, (match, num) => {
      const index = parseInt(num);
      return index > 0 && index <= sources.length ? match : '';
    });
  }
}
