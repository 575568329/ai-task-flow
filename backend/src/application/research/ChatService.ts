// backend/src/application/research/ChatService.ts
import type { ChatRepository } from '../../domain/research/repositories/ChatRepository.js';
import { ChatMessage } from '../../domain/research/entities/ChatMessage.js';
import type { LlmMessage } from '../../infrastructure/llm/LlmProvider.js';
import { ClassifierService } from './ClassifierService.js';
import { SearchOrchestrator } from './SearchOrchestrator.js';
import type { SSEEvent, Source } from '@ai-task-flow/shared';
import type { LlmConfigService } from '../llm-config/LlmConfigService.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('chat');

export interface ChatRequest {
  conversationId: string;
  message: string;
  useWebSearch: boolean;
  /**
   * 重新回答:不再追加新的用户消息,而是删掉该对话最后一条 assistant 消息后,
   * 基于已有最后一条 user 消息 + 最新 customPrompt 重新生成。
   */
  regenerate?: boolean;
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
  constructor(
    private readonly repository: ChatRepository,
    private readonly llmConfigService: LlmConfigService,
    private readonly searchOrchestrator: SearchOrchestrator,
  ) {}

  async *handleChat(request: ChatRequest): AsyncIterable<SSEEvent> {
    const { conversationId, message, useWebSearch, regenerate } = request;

    logger.info('handleChat 开始', {
      conversationId,
      useWebSearch,
      regenerate: !!regenerate,
      messagePreview: message.slice(0, 80),
    });

    // 前置拦截:未配置 apiKey 直接抛友好错误,避免分类降级 + 生成静默失败,
    // 让用户明确看到"去设置里配 Key"而不是空回答。
    if (!this.llmConfigService.isConfigured()) {
      logger.warn('handleChat 中止:apiKey 未配置', { conversationId });
      throw new Error('尚未配置 API Key,请先点击右上角「设置」填写大模型 API Key 后重试');
    }

    // 每次请求动态获取最新 Provider，支持配置热更新
    const llm = this.llmConfigService.getProvider();
    const classifier = new ClassifierService(llm);

    // 读取该对话的自定义需求(每对话独立,每轮生效)
    const conversation = await this.repository.findConversationById(conversationId);
    const customPrompt = conversation?.customPrompt?.trim() ?? '';

    // 确定本轮要回答的用户问题:
    // - 正常发送:持久化新的 user 消息
    // - 重新回答:复用已存在的最后一条 user 消息;旧 assistant 暂不删除,
    //   等新回答成功生成后再删(staleAssistantId),避免生成失败时旧回答丢失。
    let effectiveMessage = message;
    let staleAssistantId: string | null = null;
    if (regenerate) {
      const existing = await this.repository.findMessagesByConversationId(conversationId);
      const lastAssistant = [...existing].reverse().find(m => m.role === 'assistant');
      staleAssistantId = lastAssistant?.id ?? null;
      const lastUser = [...existing].reverse().find(m => m.role === 'user');
      if (!lastUser) {
        throw new Error('没有可重新回答的问题');
      }
      effectiveMessage = lastUser.content;
    } else {
      const userMsg = ChatMessage.createUser(conversationId, message);
      await this.repository.saveMessage(userMsg);
    }

    // 2. 获取历史（用于分类和 RAG）
    // - 排除待替换的旧 assistant(staleAssistantId):它是本轮要重写的回答,不能当历史。
    // - 剔除末尾的 user 消息:下方会显式 append effectiveMessage,避免同一问题重复发送。
    const history = (await this.repository.findMessagesByConversationId(conversationId))
      .filter(m => m.id !== staleAssistantId);
    const historyTrimmed = history.length > 0 && history[history.length - 1].role === 'user'
      ? history.slice(0, -1)
      : history;
    const historyForLLM: LlmMessage[] = historyTrimmed
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
      const classification = await classifier.classify(effectiveMessage, historyForLLM);

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
    const systemPrompt = this.buildWriterPrompt(sources, customPrompt);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyForLLM,
      { role: 'user', content: effectiveMessage },
    ];

    // 6. 流式生成
    let assistantContent = '';
    logger.info('开始流式生成', { sourceCount: sources.length });
    for await (const chunk of llm.streamText(messages)) {
      if (chunk.done) break;

      assistantContent += chunk.delta;
      yield {
        type: 'text-delta',
        delta: chunk.delta,
      };
    }
    logger.info('流式生成结束', { contentLength: assistantContent.length });

    // 空回答视为失败:不持久化、不删旧回答(regenerate 时旧答得以保留),抛错让前端提示
    if (!assistantContent.trim()) {
      logger.error('流式生成内容为空,判定为失败', { conversationId, regenerate: !!regenerate });
      throw new Error('模型没有返回内容,请重试或检查模型配置');
    }

    // 7. 引用编号合法性校验（剥除越界 [n]）
    const validatedContent = this.validateCitations(assistantContent, sources);

    // 8. 持久化 assistant 消息
    const assistantMsg = ChatMessage.createAssistant(conversationId, validatedContent, sources);
    await this.repository.saveMessage(assistantMsg);

    // 重新回答:新答已落库成功,此时才删旧答(失败路径上面已抛错,旧答得以保留)
    if (staleAssistantId) {
      await this.repository.deleteMessage(staleAssistantId);
    }

    // 9. done
    yield {
      type: 'done',
      messageId: assistantMsg.id,
      sources,
    };
  }

  private buildWriterPrompt(sources: Source[], customPrompt: string = ''): string {
    // 抄 Perplexica writer.ts 引用要求
    let prompt = `You are a research assistant. Provide detailed, well-structured answers.

**Formatting Requirements**:
- Use Markdown: headings, **bold** for key points, bullet/numbered lists, and \`code\` where helpful
- Keep structure clear and skimmable

**Citation Requirements**:
- Cite every fact using [number] notation
- Use [1][2] for multiple sources
- If no source supports a statement, clearly indicate the limitation

`;

    // 用户自定义需求:置于规则之后、上下文之前,每轮都生效
    if (customPrompt) {
      prompt += `**User's Custom Requirements (always follow)**:\n${customPrompt}\n\n`;
    }

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
