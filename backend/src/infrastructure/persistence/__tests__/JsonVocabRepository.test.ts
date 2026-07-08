// backend/src/infrastructure/persistence/__tests__/JsonVocabRepository.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonVocabRepository } from '../JsonVocabRepository.js';
import { Vocab } from '../../../domain/vocab/entities/Vocab.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('JsonVocabRepository', () => {
  let repository: JsonVocabRepository;
  let testFilePath: string;

  beforeEach(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vocab-repo-test-'));
    testFilePath = path.join(tmpDir, 'vocab.json');
    repository = new JsonVocabRepository(testFilePath);
  });

  afterEach(async () => {
    try { await fs.rm(path.dirname(testFilePath), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should save and find by id, default targetLang=zh', async () => {
    const vocab = Vocab.create({ word: 'hello', translation: '你好' });
    await repository.save(vocab);
    const found = await repository.findById(vocab.id);
    expect(found).not.toBeNull();
    expect(found!.word).toBe('hello');
    expect(found!.translation).toBe('你好');
    expect(found!.targetLang).toBe('zh');
    expect(found!.starred).toBe(false);
  });

  it('should update existing vocab on save (same id)', async () => {
    const vocab = Vocab.create({ word: 'world', translation: '世界' });
    await repository.save(vocab);
    vocab.toggleStar();
    await repository.save(vocab);
    const found = await repository.findById(vocab.id);
    expect(found!.starred).toBe(true);
  });

  it('should list all vocabs', async () => {
    await repository.save(Vocab.create({ word: 'a', translation: '甲' }));
    await repository.save(Vocab.create({ word: 'b', translation: '乙' }));
    expect(await repository.findAll()).toHaveLength(2);
  });

  it('should find by word+lang with case-insensitive trim normalization', async () => {
    await repository.save(Vocab.create({ word: '  Hello  ', translation: '你好' }));
    const hit = await repository.findByWordAndLang('hello', 'zh');
    expect(hit).not.toBeNull();
    // 不同 targetLang 不算重复
    expect(await repository.findByWordAndLang('hello', 'en')).toBeNull();
  });

  it('should delete vocab', async () => {
    const vocab = Vocab.create({ word: 'gone', translation: '没了' });
    await repository.save(vocab);
    await repository.delete(vocab.id);
    expect(await repository.findById(vocab.id)).toBeNull();
  });

  it('should return empty/null when file missing', async () => {
    expect(await repository.findAll()).toEqual([]);
    expect(await repository.findById('nope')).toBeNull();
    expect(await repository.findByWordAndLang('nope', 'zh')).toBeNull();
  });
});
