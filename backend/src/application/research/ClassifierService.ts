// backend/src/application/research/ClassifierService.ts
import { z } from 'zod';
import type { LlmProvider, LlmMessage } from '../../infrastructure/llm/LlmProvider.js';
import type { ClassificationResult } from '@ai-task-flow/shared';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('classifier');

// ClassificationResult 的 zod schema:补运行时校验。generateObject 实现仅 JSON.parse,
// 上游返回畸形结构({skipSearch:"yes"} 等)会静默产出非法对象污染下游检索,故在调用方 parse。
const classificationSchema = z.object({
  skipSearch: z.boolean(),
  academicSearch: z.boolean(),
  standaloneQuery: z.string(),
  searchQueries: z.array(z.string()),
});

/**
 * 分类+改写服务（抄 Perplexica classifier.ts）
 * 一次 LLM generateObject 完成：
 * - 判断是否需检索 (skipSearch)
 * - 判断是否需论文源 (academicSearch)
 * - 改写成独立问题 (standaloneQuery)
 * - 生成 SEO 关键词式检索词 (searchQueries, 最多 3 条)
 */
export class ClassifierService {
  constructor(private readonly llm: LlmProvider) {}

  async classify(
    userQuery: string,
    chatHistory: LlmMessage[],
  ): Promise<ClassificationResult> {
    const prompt = this.buildClassifierPrompt();
    const historyStr = chatHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const messages: LlmMessage[] = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `<conversation_history>\n${historyStr}\n</conversation_history>\n<user_query>\n${userQuery}\n</user_query>`,
      },
    ];

    try {
      // generateObject 仅 JSON.parse,不校验结构(其 schema 参数当前是摆设);传 schema 表意图,
      // 实际靠下方 zod.parse 兜底运行时校验。
      const raw = await this.llm.generateObject<ClassificationResult>(messages, classificationSchema);
      // 上游返回畸形结构在此抛 → 进 catch 降级,而非静默产出非法对象污染下游检索
      const result = classificationSchema.parse(raw) as ClassificationResult;

      // 保底：searchQueries 为空时用 standaloneQuery 兜底
      if (result.searchQueries.length === 0 && !result.skipSearch) {
        result.searchQueries = [result.standaloneQuery];
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Classification failed, degrading', { message });
      // 降级：默认需检索，用原话当 query
      return {
        skipSearch: false,
        academicSearch: false,
        standaloneQuery: userQuery,
        searchQueries: [userQuery],
      };
    }
  }

  private buildClassifierPrompt(): string {
    // 精简自 Perplexica classifier.ts
    return `
You are an AI classifier. Analyze the user query and conversation history to determine:

1. **skipSearch** (boolean): Can this be answered without external search?
   - true: greeting, common knowledge, writing tasks, mathematical facts
   - false: needs up-to-date info, specific details, uncertain queries
   - ALWAYS FALSE if uncertain

2. **academicSearch** (boolean): Does it explicitly request scholarly articles or research papers?
   - true: "Find recent studies on...", "What does research say about...", "Provide citations for..."
   - false: general web search suffices

3. **standaloneQuery** (string): Rephrase the user's query as self-contained, context-independent question.
   - If history is about cars and user says "How do they work", rephrase to "How do cars work?"
   - Keep it concise

4. **searchQueries** (string[]): Generate 1-3 SEO-friendly keyword queries (NOT sentences).
   - Example: "GPT-5.1 features", "GPT-5.1 release date" (not "Tell me about GPT-5.1")
   - Max 3 queries

Respond in JSON format:
{
  "skipSearch": boolean,
  "academicSearch": boolean,
  "standaloneQuery": string,
  "searchQueries": [string, string?, string?]
}
`.trim();
  }
}
