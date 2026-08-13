// frontend/src/components/chat/turnContextMenu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildTurnItems, type TurnMenuCtx } from './turnContextMenu';
import type { MenuContext } from '@/components/context-menu/types';

describe('buildTurnItems', () => {
  it('空 text 时复制项 disabled', () => {
    const ctx: TurnMenuCtx = { copy: vi.fn() };
    const items = buildTurnItems({
      target: { text: '' },
      ctx,
    } as MenuContext<{ text: string }, TurnMenuCtx>);
    const copy = items.find((i) => i.key === 'copy')!;
    expect(copy.type === 'action' && copy.disabled).toBe(true);
  });

  it('有 text 时 enabled + onSelect 调 copy', () => {
    const copy = vi.fn();
    const mc = {
      target: { text: 'hi' },
      ctx: { copy },
    } as MenuContext<{ text: string }, TurnMenuCtx>;
    const items = buildTurnItems(mc);
    const it = items.find((i) => i.key === 'copy')!;
    if (it.type === 'action') {
      expect(it.disabled).toBeFalsy();
      it.onSelect(mc);
    }
    expect(copy).toHaveBeenCalledWith('hi');
  });
});
