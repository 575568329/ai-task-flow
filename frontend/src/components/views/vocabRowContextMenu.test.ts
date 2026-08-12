// frontend/src/components/views/vocabRowContextMenu.test.ts
// 生词行右键菜单工厂测试。
import { describe, it, expect, vi } from 'vitest';
import { buildVocabRowItems, type VocabRowMenuCtx } from './vocabRowContextMenu';
import type { VocabDTO } from '@ai-task-flow/shared';
import type { MenuContext } from '@/components/context-menu/types';

function makeVocab(o: Partial<VocabDTO> = {}): VocabDTO {
  return {
    id: 'v1',
    word: 'test',
    translation: '测试',
    targetLang: 'zh',
    starred: false,
    mastered: false,
    reviewCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  };
}

function setup(vocab?: Partial<VocabDTO>) {
  const ctx: VocabRowMenuCtx = {
    speakOriginal: vi.fn(),
    speakTranslation: vi.fn(),
    toggleStar: vi.fn(),
    toggleMastered: vi.fn(),
    copyWord: vi.fn(),
    remove: vi.fn(),
  };
  const mc = { target: makeVocab(vocab), ctx } as MenuContext<VocabDTO, VocabRowMenuCtx>;
  return { ctx, mc };
}

describe('buildVocabRowItems', () => {
  it('收藏标签随 starred 状态变化', () => {
    const { mc } = setup({ starred: true });
    const items = buildVocabRowItems(mc);
    const star = items.find((i) => i.key === 'star')!;
    expect(star.type === 'action' && star.label).toBe('取消收藏');
  });

  it('掌握标签随 mastered 变化', () => {
    const { mc } = setup({ mastered: true });
    const items = buildVocabRowItems(mc);
    const m = items.find((i) => i.key === 'mastered')!;
    expect(m.type === 'action' && m.label).toBe('取消掌握');
  });

  it('各 action onSelect 触发对应回调', () => {
    const { ctx, mc } = setup();
    const items = buildVocabRowItems(mc);
    const call = (k: string) => {
      const it = items.find((i) => i.key === k);
      if (it && it.type === 'action') it.onSelect(mc);
    };
    call('star');
    expect(ctx.toggleStar).toHaveBeenCalled();
    call('copy');
    expect(ctx.copyWord).toHaveBeenCalled();
    call('delete');
    expect(ctx.remove).toHaveBeenCalled();
  });

  it('删除项 danger=true', () => {
    const { mc } = setup();
    const items = buildVocabRowItems(mc);
    const del = items.find((i) => i.key === 'delete')!;
    expect(del.type === 'action' && del.danger).toBe(true);
  });
});
