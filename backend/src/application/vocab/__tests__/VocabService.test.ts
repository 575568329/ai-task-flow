// backend/src/application/vocab/__tests__/VocabService.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { VocabService, VocabAlreadyExistsError, VocabNotFoundError } from '../VocabService.js';
import type { VocabRepository } from '../../../domain/vocab/repositories/VocabRepository.js';
import type { Vocab } from '../../../domain/vocab/entities/Vocab.js';
import type { LlmConfigService } from '../../llm-config/LlmConfigService.js';
import type { LlmProvider, StreamChunk } from '../../../infrastructure/llm/LlmProvider.js';

/** 内存 mock 仓储，复刻 JsonVocabRepository 的去重判定逻辑 */
function createMockRepo(): VocabRepository {
  const store = new Map<string, Vocab>();
  return {
    async save(v) { store.set(v.id, v); },
    async findById(id) { return store.get(id) ?? null; },
    async findAll() { return [...store.values()]; },
    async findByWordAndLang(word, targetLang) {
      const key = `${word.trim().toLowerCase()}|${targetLang}`;
      return [...store.values()].find(v => v.uniqueKey() === key) ?? null;
    },
    async delete(id) { store.delete(id); },
  };
}

// P0 CRUD 不使用 LLM；translate（P1）才用。这里给个空 stub 满足构造注入。
const mockLlmConfig = {} as unknown as LlmConfigService;

/** 构造带 mock provider 的 LlmConfigService（translate 测试用） */
function mockLlmConfigWithProvider(provider: LlmProvider, configured = true): LlmConfigService {
  return {
    getProvider: () => provider,
    isConfigured: () => configured,
  } as unknown as LlmConfigService;
}

/** mock provider：generateObject 返回/抛错 + streamText 输出 deltas 可定制 */
function mockProvider(opts: {
  objectResult?: unknown;
  objectThrows?: Error;
  streamDeltas?: string[];
}): LlmProvider {
  return {
    async generateObject() {
      if (opts.objectThrows) throw opts.objectThrows;
      return opts.objectResult;
    },
    async *streamText(): AsyncIterable<StreamChunk> {
      for (const d of opts.streamDeltas ?? []) yield { delta: d, done: false };
      yield { delta: '', done: true };
    },
  } as unknown as LlmProvider;
}

describe('VocabService', () => {
  let service: VocabService;

  beforeEach(() => {
    service = new VocabService(createMockRepo(), mockLlmConfig);
  });

  it('saveVocab 同 word+targetLang 抛 VocabAlreadyExistsError（大小写/空格无关）', async () => {
    await service.saveVocab({ word: 'hello', translation: '你好' });
    await expect(service.saveVocab({ word: '  Hello ', translation: '你好啊' }))
      .rejects.toBeInstanceOf(VocabAlreadyExistsError);
  });

  it('saveVocab 不同 targetLang 不算重复', async () => {
    await service.saveVocab({ word: 'hello', translation: '你好', targetLang: 'zh' });
    await service.saveVocab({ word: 'hello', translation: 'hallo', targetLang: 'de' });
    const list = await service.listVocab({});
    expect(list.total).toBe(2);
  });

  it('getVocab 不存在抛 VocabNotFoundError', async () => {
    await expect(service.getVocab('nope')).rejects.toBeInstanceOf(VocabNotFoundError);
  });

  it('listVocab 关键词匹配 word 或 translation', async () => {
    await service.saveVocab({ word: 'apple', translation: '苹果' });
    await service.saveVocab({ word: 'banana', translation: '香蕉' });
    expect((await service.listVocab({ kw: 'app' })).total).toBe(1);
    expect((await service.listVocab({ kw: '香蕉' })).total).toBe(1);
  });

  it('listVocab mastered 过滤 + 分页', async () => {
    const a = await service.saveVocab({ word: 'a', translation: '甲' });
    await service.saveVocab({ word: 'b', translation: '乙' });
    await service.updateVocab(a.id, { mastered: true });
    expect((await service.listVocab({ mastered: true })).total).toBe(1);
    expect((await service.listVocab({ pageSize: 1 })).items).toHaveLength(1);
  });

  it('updateVocab 标记掌握后 reviewCount 累加 + lastReviewedAt 落位', async () => {
    const v = await service.saveVocab({ word: 'word', translation: '词' });
    const updated = await service.updateVocab(v.id, { mastered: true, starred: true });
    expect(updated.mastered).toBe(true);
    expect(updated.starred).toBe(true);
    expect(updated.reviewCount).toBe(1);
    expect(updated.lastReviewedAt).toBeTruthy();
  });

  it('updateVocab 不存在抛 VocabNotFoundError', async () => {
    await expect(service.updateVocab('nope', { starred: true }))
      .rejects.toBeInstanceOf(VocabNotFoundError);
  });

  it('deleteVocab 不存在抛 VocabNotFoundError', async () => {
    await expect(service.deleteVocab('nope')).rejects.toBeInstanceOf(VocabNotFoundError);
  });
});

describe('VocabService.translate', () => {
  it('JSON 模式成功：直接返回结构化翻译', async () => {
    const provider = mockProvider({
      objectResult: { sourceLang: 'en', translation: '你好', pos: 'int.', definition: 'greeting', example: 'Hello!' },
    });
    const service = new VocabService(createMockRepo(), mockLlmConfigWithProvider(provider));
    const r = await service.translate('hello');
    expect(r.translation).toBe('你好');
    expect(r.sourceLang).toBe('en');
    expect(r.pos).toBe('int.');
  });

  it('normalize：空字符串的可选字段省略为 undefined', async () => {
    const provider = mockProvider({
      objectResult: { sourceLang: 'en', translation: '你好', pos: '', definition: '', example: '' },
    });
    const service = new VocabService(createMockRepo(), mockLlmConfigWithProvider(provider));
    const r = await service.translate('hello');
    expect(r.translation).toBe('你好');
    expect(r.pos).toBeUndefined();
    expect(r.example).toBeUndefined();
  });

  it('降级：generateObject 抛错 → streamText + parseLooseJson（剥 ```json fence）', async () => {
    const provider = mockProvider({
      objectThrows: new Error('json mode unsupported'),
      streamDeltas: ['```json\n{"sourceLang":"en","translation":"你好"}\n```'],
    });
    const service = new VocabService(createMockRepo(), mockLlmConfigWithProvider(provider));
    const r = await service.translate('hello');
    expect(r.translation).toBe('你好');
    expect(r.sourceLang).toBe('en');
  });

  it('降级兜底：流式输出非 JSON → 原文当译文', async () => {
    const provider = mockProvider({
      objectThrows: new Error('boom'),
      streamDeltas: ['这根本不是 JSON,就是一段纯文本译文'],
    });
    const service = new VocabService(createMockRepo(), mockLlmConfigWithProvider(provider));
    const r = await service.translate('hello');
    expect(r.translation).toBe('这根本不是 JSON,就是一段纯文本译文');
  });

  it('未配置 LLM：抛友好错误（含 API Key/设置）', async () => {
    const service = new VocabService(createMockRepo(), mockLlmConfigWithProvider(mockProvider({}), false));
    await expect(service.translate('hi')).rejects.toThrow(/API Key|设置/);
  });
});
