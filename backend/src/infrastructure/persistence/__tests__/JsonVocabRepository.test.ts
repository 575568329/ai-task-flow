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

  it('should default studySyncStatus to pending for new vocabs', async () => {
    const vocab = Vocab.create({ word: 'sync-me', translation: '同步我' });
    await repository.save(vocab);
    const found = await repository.findById(vocab.id);
    expect(found!.studySyncStatus).toBe('pending');
    expect(found!.maimemoVocId).toBeUndefined();
  });

  it('saveMany should batch upsert in a single write', async () => {
    const a = Vocab.create({ word: 'a', translation: '甲' });
    await repository.save(a); // 预置一条
    a.toggleStar(); // 改动既有（测 upsert）
    const b = Vocab.create({ word: 'b', translation: '乙' });
    const c = Vocab.create({ word: 'c', translation: '丙' });
    await repository.saveMany([a, b, c]);
    const all = await repository.findAll();
    expect(all).toHaveLength(3);
    expect(all.find(v => v.id === a.id)!.starred).toBe(true);
    expect(all.find(v => v.id === b.id)).toBeDefined();
  });

  it('saveMany with empty array should be a no-op', async () => {
    await repository.save(Vocab.create({ word: 'x', translation: '叉' }));
    await repository.saveMany([]); // 不应抛错、不应改动文件
    expect(await repository.findAll()).toHaveLength(1);
  });

  it('findByStudySyncStatus should filter by status (default pending)', async () => {
    const pending = Vocab.create({ word: 'p', translation: '待' });
    const synced = Vocab.create({ word: 's', translation: '已' });
    synced.markStudySynced('voc-1');
    await repository.saveMany([pending, synced]);
    expect(await repository.findByStudySyncStatus('pending')).toHaveLength(1);
    expect(await repository.findByStudySyncStatus('synced')).toHaveLength(1);
    expect((await repository.findByStudySyncStatus('pending'))[0].word).toBe('p');
  });

  it('should serialize concurrent writes (mutex prevents lost updates)', async () => {
    // 50 个并发 save，全部应落盘（无后写覆盖前写丢词）
    const vocabs = Array.from({ length: 50 }, (_, i) =>
      Vocab.create({ word: `w${i}`, translation: `译${i}` }),
    );
    await Promise.all(vocabs.map(v => repository.save(v)));
    const all = await repository.findAll();
    expect(all).toHaveLength(50);
    // 并发期间穿插一次 delete 也不应破坏数据
    const extra = Vocab.create({ word: 'extra', translation: '额外' });
    await repository.save(extra);
    await Promise.all([
      repository.delete(extra.id),
      ...Array.from({ length: 10 }, (_, i) =>
        repository.save(Vocab.create({ word: `more${i}`, translation: `多${i}` })),
      ),
    ]);
    const after = await repository.findAll();
    expect(after.find(v => v.id === extra.id)).toBeUndefined();
    expect(after).toHaveLength(60);
  });
});

