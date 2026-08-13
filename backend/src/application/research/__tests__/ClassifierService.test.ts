// backend/src/application/research/__tests__/ClassifierService.test.ts
// 验证 ClassifierService 三条路径:正常返回(zod parse 通过 + 兜底)、畸形返回(parse 失败降级)、
// generateObject 抛错(降级)。重点验证 P1-13 补的 zod 运行时校验真的生效。
import { describe, it, expect } from 'vitest';
import { ClassifierService } from '../ClassifierService.js';
import type { LlmProvider, LlmMessage } from '../../../infrastructure/llm/LlmProvider.js';

/** 构造 mock provider:generateObject 返回指定对象(或抛错)。streamText 不被测,给空实现。 */
function makeProvider(generateObjectImpl: () => Promise<unknown>): LlmProvider {
  return {
    streamText: async function* () {
      yield { delta: '', done: true };
    },
    generateObject: async (_messages: LlmMessage[]) => generateObjectImpl() as never,
  } as unknown as LlmProvider;
}

describe('ClassifierService', () => {
  it('正常返回:zod parse 通过;searchQueries 空 + 非 skipSearch → 用 standaloneQuery 兜底', async () => {
    const provider = makeProvider(async () => ({
      skipSearch: false,
      academicSearch: false,
      standaloneQuery: 'how do cars work',
      searchQueries: [],
    }));
    const result = await new ClassifierService(provider).classify('how do they work', []);
    expect(result.skipSearch).toBe(false);
    expect(result.standaloneQuery).toBe('how do cars work');
    expect(result.searchQueries).toEqual(['how do cars work']);
  });

  it('畸形返回(skipSearch 为字符串):zod parse 失败 → 降级为默认(需检索 + 原话当 query)', async () => {
    const provider = makeProvider(async () => ({ skipSearch: 'yes', searchQueries: 'oops' }));
    const result = await new ClassifierService(provider).classify('hello world', []);
    expect(result).toEqual({
      skipSearch: false,
      academicSearch: false,
      standaloneQuery: 'hello world',
      searchQueries: ['hello world'],
    });
  });

  it('generateObject 抛错 → 降级为默认(不向外抛)', async () => {
    const provider = makeProvider(async () => { throw new Error('LLM upstream down'); });
    const result = await new ClassifierService(provider).classify('any query', []);
    expect(result.skipSearch).toBe(false);
    expect(result.searchQueries).toEqual(['any query']);
  });

  it('正常返回 + searchQueries 有值:原样保留,不覆盖', async () => {
    const provider = makeProvider(async () => ({
      skipSearch: true,
      academicSearch: true,
      standaloneQuery: 'q',
      searchQueries: ['GPT-5 features', 'GPT-5 release'],
    }));
    const result = await new ClassifierService(provider).classify('q', []);
    expect(result.skipSearch).toBe(true);
    expect(result.academicSearch).toBe(true);
    expect(result.searchQueries).toEqual(['GPT-5 features', 'GPT-5 release']);
  });
});
