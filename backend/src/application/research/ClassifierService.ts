// backend/src/application/research/ClassifierService.ts
import type { LlmProvider, LlmMessage } from '../../infrastructure/llm/LlmProvider.js';
import type { ClassificationResult } from '@ai-task-flow/shared';

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
      // generateObject 返回 JSON 结构化输出
      const result = await this.llm.generateObject<ClassificationResult>(messages, {
        /* zod schema 后续补充 */
      });

      // 保底：searchQueries 为空时用 standaloneQuery 兜底
      if (result.searchQueries.length === 0 && !result.skipSearch) {
        result.searchQueries = [result.standaloneQuery];
      }

      return result;
    } catch (error: any) {
      console.error('Classification failed, degrading:', error.message);
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
