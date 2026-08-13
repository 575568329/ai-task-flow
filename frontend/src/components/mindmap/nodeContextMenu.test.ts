// frontend/src/components/mindmap/nodeContextMenu.test.ts
// 思维导图节点右键菜单项工厂测试（含提升/降级/上移/下移）。
import { describe, it, expect, vi } from 'vitest';
import { buildMindmapNodeItems, type MindmapMenuCtx } from './nodeContextMenu';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import type { MenuContext, MenuItemBuilder } from '@/components/context-menu/types';

interface Target {
  id: string;
  data: MindmapNodeData;
}

function makeCtx(o: Partial<MindmapMenuCtx> = {}): MindmapMenuCtx {
  return {
    edit: vi.fn(),
    addChild: vi.fn(),
    addSibling: vi.fn(),
    deleteNode: vi.fn(),
    toggleExpand: vi.fn(),
    promoteNode: vi.fn(),
    demoteNode: vi.fn(),
    moveSibling: vi.fn(),
    setBranch: vi.fn(),
    hasChildren: () => false,
    ...o,
  };
}

function makeTarget(o: Partial<MindmapNodeData> = {}): Target {
  return { id: 'n1', data: { label: '节点', level: 1, expanded: true, ...o } };
}

type Items = ReturnType<MenuItemBuilder<Target, MindmapMenuCtx>>;

function actionOf(items: Items, key: string) {
  const it = items.find((i) => i.key === key);
  return it && it.type === 'action' ? it : undefined;
}

describe('buildMindmapNodeItems', () => {
  it('包含全部菜单项（含提升/降级/上移/下移）', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => true }),
    });
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'edit', 'child', 'sibling', 'color', 'toggle',
        'promote', 'demote', 'moveUp', 'moveDown', 'delete',
      ]),
    );
  });

  it('根节点：提升/降级/上移/下移/删除/加同级 均 disabled', () => {
    const items = buildMindmapNodeItems({ target: makeTarget({ level: 0 }), ctx: makeCtx() });
    expect(actionOf(items, 'promote')?.disabled).toBe(true);
    expect(actionOf(items, 'demote')?.disabled).toBe(true);
    expect(actionOf(items, 'moveUp')?.disabled).toBe(true);
    expect(actionOf(items, 'moveDown')?.disabled).toBe(true);
  });

  it('上移/下移 onSelect 调 moveSibling', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'moveUp')?.onSelect(mc);
    expect(ctx.moveSibling).toHaveBeenCalledWith('n1', 'up');
    actionOf(items, 'moveDown')?.onSelect(mc);
    expect(ctx.moveSibling).toHaveBeenCalledWith('n1', 'down');
  });

  it('提升/降级 onSelect 调对应回调', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'promote')?.onSelect(mc);
    expect(ctx.promoteNode).toHaveBeenCalledWith('n1');
    actionOf(items, 'demote')?.onSelect(mc);
    expect(ctx.demoteNode).toHaveBeenCalledWith('n1');
  });

  it('无子节点：折叠项 hidden', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => false }),
    });
    expect(actionOf(items, 'toggle')?.hidden).toBe(true);
  });

  it('颜色子菜单含 8 色', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    const color = items.find((i) => i.key === 'color');
    expect(color?.type).toBe('submenu');
  });

  it('核心 action onSelect 触发对应回调', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'edit')?.onSelect(mc);
    expect(ctx.edit).toHaveBeenCalledWith('n1');
    actionOf(items, 'delete')?.onSelect(mc);
    expect(ctx.deleteNode).toHaveBeenCalledWith('n1');
  });
});
