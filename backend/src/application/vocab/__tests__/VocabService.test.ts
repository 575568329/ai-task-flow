// backend/src/application/vocab/__tests__/VocabService.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { VocabService, VocabAlreadyExistsError, VocabNotFoundError } from '../VocabService.js';
import type { VocabRepository } from '../../../domain/vocab/repositories/VocabRepository.js';
import type { Vocab } from '../../../domain/vocab/entities/Vocab.js';
import type { LlmConfigService } from '../../llm-config/LlmConfigService.js';

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
