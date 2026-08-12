// frontend/src/components/mindmap/canvasContextMenu.test.ts
// 画布右键菜单工厂测试：菜单项 + onSelect 回调。
import { describe, it, expect, vi } from 'vitest';
import { buildCanvasItems, type MindmapCanvasCtx } from './canvasContextMenu';
import type { MenuContext } from '@/components/context-menu/types';

describe('buildCanvasItems', () => {
  function setup() {
    const ctx: MindmapCanvasCtx = { autoLayout: vi.fn(), fitView: vi.fn() };
    const mc = { target: null, ctx } as MenuContext<null, MindmapCanvasCtx>;
    return { ctx, mc };
  }

  it('包含「自动布局」与「适应视图」两项，顺序固定', () => {
    const { mc } = setup();
    const items = buildCanvasItems(mc);
    expect(items.map((i) => i.key)).toEqual(['layout', 'fit']);
    expect(items.every((i) => i.type === 'action')).toBe(true);
  });

  it('自动布局 onSelect 调 ctx.autoLayout', () => {
    const { ctx, mc } = setup();
    const items = buildCanvasItems(mc);
    const layout = items.find((i) => i.key === 'layout');
    if (layout?.type === 'action') layout.onSelect(mc);
    expect(ctx.autoLayout).toHaveBeenCalledTimes(1);
  });

  it('适应视图 onSelect 调 ctx.fitView', () => {
    const { ctx, mc } = setup();
    const items = buildCanvasItems(mc);
    const fit = items.find((i) => i.key === 'fit');
    if (fit?.type === 'action') fit.onSelect(mc);
    expect(ctx.fitView).toHaveBeenCalledTimes(1);
  });
});
