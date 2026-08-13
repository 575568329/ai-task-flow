// backend/src/domain/vocab/entities/__tests__/Vocab.test.ts
// Vocab 聚合实体单测(报告 P2-17:同 context Service 测了 224 行,实体 172 行零测试)。
// 覆盖:create 默认值 / toggleStar / updateMastered 状态机 / uniqueKey 去重 /
// 墨墨同步状态机(syncing→synced/failed/reset) / toJSON·fromJSON 往返保真。
import { describe, it, expect } from 'vitest';
import { Vocab } from '../Vocab.js';

describe('Vocab 实体', () => {
  describe('create', () => {
    it('默认值:未收藏/未掌握/0 复习/待同步/targetLang 默认 zh', () => {
      const v = Vocab.create({ word: 'hello', translation: '你好' });
      expect(v.id).toBeTruthy();
      expect(v.word).toBe('hello');
      expect(v.translation).toBe('你好');
      expect(v.targetLang).toBe('zh');
      expect(v.starred).toBe(false);
      expect(v.mastered).toBe(false);
      expect(v.reviewCount).toBe(0);
      expect(v.lastReviewedAt).toBeUndefined();
      expect(v.studySyncStatus).toBe('pending');
      expect(v.createdAt).toBeInstanceOf(Date);
    });

    it('targetLang/可选字段显式传入生效', () => {
      const v = Vocab.create({
        word: 'x', translation: 'y', targetLang: 'en', pos: 'n', definition: 'd', example: 'ex',
      });
      expect(v.targetLang).toBe('en');
      expect(v.pos).toBe('n');
      expect(v.definition).toBe('d');
      expect(v.example).toBe('ex');
    });
  });

  describe('toggleStar', () => {
    it('翻转收藏 + 更新 updatedAt', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      expect(v.starred).toBe(false);
      const before = v.updatedAt;
      v.toggleStar();
      expect(v.starred).toBe(true);
      v.toggleStar();
      expect(v.starred).toBe(false);
      expect(v.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('updateMastered', () => {
    it('标记掌握:reviewCount +1 + lastReviewedAt 设置', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.updateMastered(true);
      expect(v.mastered).toBe(true);
      expect(v.reviewCount).toBe(1);
      expect(v.lastReviewedAt).toBeInstanceOf(Date);
    });

    it('取消掌握:不回退 reviewCount', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.updateMastered(true);
      expect(v.reviewCount).toBe(1);
      v.updateMastered(false);
      expect(v.mastered).toBe(false);
      expect(v.reviewCount).toBe(1); // 不回退
    });

    it('多次「标记→取消→标记」:reviewCount 按标记次数累加', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.updateMastered(true);   // 1
      v.updateMastered(false);
      v.updateMastered(true);   // 2
      v.updateMastered(false);
      v.updateMastered(true);   // 3
      expect(v.reviewCount).toBe(3);
    });
  });

  describe('uniqueKey 去重', () => {
    it('word trim+小写 + targetLang', () => {
      const v = Vocab.create({ word: '  Hello  ', translation: 'x' });
      expect(v.uniqueKey()).toBe('hello|zh');
    });

    it('同 word 不同 targetLang → 不同 key(不误去重)', () => {
      const a = Vocab.create({ word: 'hello', translation: 'x', targetLang: 'zh' });
      const b = Vocab.create({ word: 'HELLO', translation: 'x', targetLang: 'en' });
      expect(a.uniqueKey()).not.toBe(b.uniqueKey());
    });

    it('大小写/空格差异的同词同语言 → 同 key(去重)', () => {
      const a = Vocab.create({ word: 'Hello', translation: 'x' });
      const b = Vocab.create({ word: '  hello ', translation: 'x' });
      expect(a.uniqueKey()).toBe(b.uniqueKey());
    });
  });

  describe('墨墨同步状态机', () => {
    it('markStudySyncing → syncing + 清上次错误', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.markStudyFailed('old err');
      v.markStudySyncing();
      expect(v.studySyncStatus).toBe('syncing');
      expect(v.studySyncError).toBeUndefined();
    });

    it('markStudySynced → synced + 缓存 vocId + 记录时间', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.markStudySynced('voc-123');
      expect(v.studySyncStatus).toBe('synced');
      expect(v.maimemoVocId).toBe('voc-123');
      expect(v.studySyncError).toBeUndefined();
      expect(v.studySyncedAt).toBeInstanceOf(Date);
    });

    it('markStudyFailed → failed + 记录原因(保留已缓存 vocId 供下次复用)', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.markStudySynced('voc-1');
      v.markStudyFailed('network down');
      expect(v.studySyncStatus).toBe('failed');
      expect(v.studySyncError).toBe('network down');
      expect(v.maimemoVocId).toBe('voc-1');
    });

    it('resetStudyPending → pending + 清错误(回收残留 syncing,防进程崩溃中断)', () => {
      const v = Vocab.create({ word: 'x', translation: 'y' });
      v.markStudySyncing();
      v.resetStudyPending();
      expect(v.studySyncStatus).toBe('pending');
      expect(v.studySyncError).toBeUndefined();
    });
  });

  describe('toJSON / fromJSON 往返', () => {
    it('round-trip 保真(全部字段含同步状态)', () => {
      const v = Vocab.create({
        word: 'test', translation: '测试', pos: 'n', definition: 'a test', targetLang: 'en',
      });
      v.toggleStar();
      v.updateMastered(true);
      v.markStudySynced('voc-9');
      const restored = Vocab.fromJSON(v.toJSON());
      expect(restored.word).toBe('test');
      expect(restored.translation).toBe('测试');
      expect(restored.targetLang).toBe('en');
      expect(restored.pos).toBe('n');
      expect(restored.starred).toBe(true);
      expect(restored.mastered).toBe(true);
      expect(restored.reviewCount).toBe(1);
      expect(restored.studySyncStatus).toBe('synced');
      expect(restored.maimemoVocId).toBe('voc-9');
      expect(restored.uniqueKey()).toBe(v.uniqueKey());
    });

    it('fromJSON 旧数据无 studySyncStatus → 视为 pending(向后兼容)', () => {
      const dto = Vocab.create({ word: 'x', translation: 'y' }).toJSON();
      delete (dto as { studySyncStatus?: string }).studySyncStatus;
      expect(Vocab.fromJSON(dto).studySyncStatus).toBe('pending');
    });
  });
});
