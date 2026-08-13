// backend/src/application/maimemo/__tests__/MaimemoService.test.ts
// MaimemoService 核心逻辑单测(报告 P2-17:318 行最长 service 零测试)。聚焦无需完整 HTTP 流水线的
// 核心:init 崩溃恢复(重置残留 syncing) + 配置脱敏 + testConnection 节流/未配置/401。
// 完整同步流水线(syncToNotepad/syncToStudyPlan 批处理)需深 mock,留后续。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaimemoService } from '../MaimemoService.js';
import type { MaimemoConfigRepository } from '../../../domain/maimemo/MaimemoConfigRepository.js';
import type { VocabRepository } from '../../../domain/vocab/repositories/VocabRepository.js';
import type { MaimemoClient } from '../../../infrastructure/maimemo/MaimemoClient.js';
import { MaimemoApiError } from '../../../infrastructure/maimemo/MaimemoClient.js';
import { Vocab } from '../../../domain/vocab/entities/Vocab.js';

type ConfigData = { token: string; notepadId?: string; notepadTitle?: string; lastNotepadSyncAt?: string };

// makeService async:内部 init() 加载 configData(否则 isConfigured/getMaskedConfig 因 configData=null 误判)
async function makeService(overrides: { token?: string; syncing?: Vocab[] } = {}) {
  const config: ConfigData = { token: overrides.token ?? 'tok-secret-123456', notepadId: undefined };
  const configRepo = {
    load: vi.fn(async () => config),
    save: vi.fn(async () => undefined),
  } as unknown as MaimemoConfigRepository;
  const vocabRepo = {
    findAll: vi.fn(async () => []),
    findByStudySyncStatus: vi.fn(async () => overrides.syncing ?? []),
    findByStudySyncStatuses: vi.fn(async () => []),
    saveMany: vi.fn(async () => undefined),
  } as unknown as VocabRepository;
  const client = {
    listNotepads: vi.fn(async () => ({ notepads: [] })),
    queryVocabularyBatch: vi.fn(async () => ({ vocIdBySpelling: new Map() })),
    addWords: vi.fn(async () => ({ added: 0 })),
  } as unknown as MaimemoClient;
  const service = new MaimemoService(configRepo, vocabRepo);
  service.useClient(client);
  await service.init(); // 加载 configData + 重置残留 syncing
  return { service, configRepo, vocabRepo, client, config };
}

describe('MaimemoService 核心(配置/init/节流)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init 崩溃恢复', () => {
    it('残留 syncing 词重置为 pending + saveMany', async () => {
      const stuck = [Vocab.create({ word: 'a', translation: '甲' }), Vocab.create({ word: 'b', translation: '乙' })];
      stuck.forEach((v) => v.markStudySyncing());
      // makeService 内 init 已消费一次 findByStudySyncStatus/saveMany;为隔离,单独再测
      const { vocabRepo } = await makeService({ syncing: stuck });
      expect(vocabRepo.findByStudySyncStatus).toHaveBeenCalledWith('syncing');
      expect(vocabRepo.saveMany).toHaveBeenCalled();
      expect(stuck.every((v) => v.studySyncStatus === 'pending')).toBe(true);
    });

    it('无残留 syncing 时不调 saveMany', async () => {
      const { vocabRepo } = await makeService({ syncing: [] });
      expect(vocabRepo.saveMany).not.toHaveBeenCalled();
    });
  });

  describe('isConfigured', () => {
    it('token 非空 → true', async () => {
      const { service } = await makeService({ token: 'tok' });
      expect(service.isConfigured()).toBe(true);
    });
    it('token 空/空白 → false', async () => {
      expect((await makeService({ token: '' })).service.isConfigured()).toBe(false);
      expect((await makeService({ token: '   ' })).service.isConfigured()).toBe(false);
    });
  });

  describe('getMaskedConfig 脱敏(永不回明文)', () => {
    it('tokenSet=true + tokenMasked 非空且不含明文', async () => {
      const { service, config } = await makeService({ token: 'tok-secret-123456' });
      const masked = service.getMaskedConfig();
      expect(masked.tokenSet).toBe(true);
      expect(masked.tokenMasked).toBeTruthy();
      expect(masked.tokenMasked).not.toContain(config.token);
    });

    it('空 token → tokenSet=false + tokenMasked 空', async () => {
      const masked = (await makeService({ token: '' })).service.getMaskedConfig();
      expect(masked.tokenSet).toBe(false);
      expect(masked.tokenMasked).toBe('');
    });
  });

  describe('saveConfig(空 token 保持原值)', () => {
    it('传非空 token → 保存', async () => {
      const { service, configRepo } = await makeService();
      await service.saveConfig({ token: 'new-tok-9999' });
      expect(configRepo.save).toHaveBeenCalled();
    });

    it('传空 token → 不覆盖原值(保持现状)', async () => {
      const { service, configRepo } = await makeService({ token: 'original-tok' });
      await service.saveConfig({ token: '' });
      const saved = (configRepo.save as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(saved?.token).not.toBe(''); // 不被空覆盖
    });
  });

  describe('testConnection 节流 + 状态', () => {
    it('未配置 token → {ok:false},不调 client', async () => {
      const { service, client } = await makeService({ token: '' });
      const r = await service.testConnection();
      expect(r.ok).toBe(false);
      expect(client.listNotepads).not.toHaveBeenCalled();
    });

    it('已配置 + client 成功 → {ok:true, 连接正常}', async () => {
      const { service } = await makeService();
      const r = await service.testConnection();
      expect(r.ok).toBe(true);
      expect(r.message).toBe('连接正常');
    });

    it('10s 节流:连续调只命中 client 一次', async () => {
      const { service, client } = await makeService();
      await service.testConnection();
      await service.testConnection();
      expect(client.listNotepads).toHaveBeenCalledTimes(1);
    });

    it('401 → token 无效文案', async () => {
      const { service, client } = await makeService();
      (client.listNotepads as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new MaimemoApiError(401, 'invalid'),
      );
      const r = await service.testConnection();
      expect(r.ok).toBe(false);
      expect(r.message).toContain('token');
    });
  });
});
