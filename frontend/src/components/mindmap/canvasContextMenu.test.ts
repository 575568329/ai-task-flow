// frontend/src/components/mindmap/canvasContextMenu.test.ts
// 画布右键菜单工厂测试：菜单项 + onSelect 回调。
import { describe, it, expect, vi } from 'vitest';
import { buildCanvasItems, type MindmapCanvasCtx } from './canvasContextMenu';
import type { MenuContext } from '@/components/context-menu/types';

describe('buildCanvasItems', () => {
  function setup(showGrid = true, isTree = false) {
    const ctx: MindmapCanvasCtx = {
      autoLayout: vi.fn(),
      fitView: vi.fn(),
      exportPng: vi.fn(),
      showGrid,
      toggleGrid: vi.fn(),
      isTree,
      toggleMode: vi.fn(),
      createImageNode: vi.fn(),
      openMermaidImport: vi.fn(),
    };
    const mc = { target: null, ctx } as MenuContext<null, MindmapCanvasCtx>;
    return { ctx, mc };
  }

  it('包含 模式切换 / 插入图片 / 导入Mermaid / 自动布局 / 适应视图 / 网格开关 / 导出PNG', () => {
    const { mc } = setup();
    const items = buildCanvasItems(mc);
    expect(items.map((i) => i.key)).toEqual(['mode', 's0', 'image', 'mermaid', 'layout', 'fit', 'grid', 's1', 'export']);
    expect(items.filter((i) => i.type === 'action')).toHaveLength(7);
    expect(items.filter((i) => i.type === 'separator')).toHaveLength(2);
  });

  it('导入 Mermaid onSelect 调 ctx.openMermaidImport', () => {
    const { ctx, mc } = setup();
    const mermaid = buildCanvasItems(mc).find((i) => i.key === 'mermaid');
    if (mermaid?.type === 'action') mermaid.onSelect(mc);
    expect(ctx.openMermaidImport).toHaveBeenCalledTimes(1);
  });

  it('插入图片 onSelect 调 ctx.createImageNode', () => {
    const { ctx, mc } = setup();
    const image = buildCanvasItems(mc).find((i) => i.key === 'image');
    if (image?.type === 'action') image.onSelect(mc);
    expect(ctx.createImageNode).toHaveBeenCalledTimes(1);
  });

  it('模式切换 label 随 isTree 切换且 onSelect 调 ctx.toggleMode', () => {
    const { ctx, mc } = setup(true, true);
    const modeItem = buildCanvasItems(mc).find((i) => i.key === 'mode');
    if (modeItem?.type === 'action') {
      expect(modeItem.label).toBe('切换为画布模式');
      modeItem.onSelect(mc);
    }
    expect(ctx.toggleMode).toHaveBeenCalledTimes(1);

    const canvas = setup(true, false);
    const canvasItem = buildCanvasItems(canvas.mc).find((i) => i.key === 'mode');
    if (canvasItem?.type === 'action') expect(canvasItem.label).toBe('切换为树形模式');
  });

  it('网格开关 label 随 showGrid 切换且 onSelect 调 ctx.toggleGrid', () => {
    const { ctx, mc } = setup(true);
    const gridItem = buildCanvasItems(mc).find((i) => i.key === 'grid');
    if (gridItem?.type === 'action') {
      expect(gridItem.label).toBe('隐藏网格');
      gridItem.onSelect(mc);
    }
    expect(ctx.toggleGrid).toHaveBeenCalledTimes(1);

    const off = setup(false);
    const offItem = buildCanvasItems(off.mc).find((i) => i.key === 'grid');
    if (offItem?.type === 'action') expect(offItem.label).toBe('显示网格');
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

  it('导出 PNG onSelect 调 ctx.exportPng', () => {
    const { ctx, mc } = setup();
    const items = buildCanvasItems(mc);
    const exp = items.find((i) => i.key === 'export');
    if (exp?.type === 'action') exp.onSelect(mc);
    expect(ctx.exportPng).toHaveBeenCalledTimes(1);
  });
});
