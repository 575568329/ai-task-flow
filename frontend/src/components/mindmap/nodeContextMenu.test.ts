// frontend/src/components/mindmap/nodeContextMenu.test.ts
// 思维导图节点右键菜单项工厂测试。
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
function submenuOf(items: Items, key: string) {
  const it = items.find((i) => i.key === key);
  return it && it.type === 'submenu' ? it : undefined;
}

describe('buildMindmapNodeItems', () => {
  it('包含核心菜单项 + 3 分隔符（含提升/降级）', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => true }),
    });
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'edit',
        'child',
        'sibling',
        'color',
        'toggle',
        'promote',
        'demote',
        'delete',
      ]),
    );
    expect(items.filter((i) => i.type === 'separator')).toHaveLength(3);
  });

  it('根节点：删除/加同级/提升/降级 disabled', () => {
    const items = buildMindmapNodeItems({ target: makeTarget({ level: 0 }), ctx: makeCtx() });
    expect(actionOf(items, 'delete')?.disabled).toBe(true);
    expect(actionOf(items, 'sibling')?.disabled).toBe(true);
    expect(actionOf(items, 'promote')?.disabled).toBe(true);
    expect(actionOf(items, 'demote')?.disabled).toBe(true);
  });

  it('提升/降级 onSelect 触发对应回调', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'promote')?.onSelect(mc);
    expect(ctx.promoteNode).toHaveBeenCalledWith('n1');
    actionOf(items, 'demote')?.onSelect(mc);
    expect(ctx.demoteNode).toHaveBeenCalledWith('n1');
  });

  it('颜色子菜单含 8 色，首色 onSelect 调 setBranch(blue)', () => {
    const setBranch = vi.fn();
    const ctx = makeCtx({ setBranch });
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    const color = submenuOf(items, 'color');
    expect(color).toBeDefined();
    const sub = typeof color!.items === 'function' ? color!.items(mc) : color!.items;
    expect(sub).toHaveLength(8);
    const first = sub[0];
    if (first.type === 'action') first.onSelect(mc);
    expect(setBranch).toHaveBeenCalledWith('n1', 'blue');
  });

  it('无子节点：折叠项 hidden', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => false }),
    });
    expect(actionOf(items, 'toggle')?.hidden).toBe(true);
  });

  it('编辑/加子/加同级/删除 onSelect 触发对应回调', () => {
    const ctx = makeCtx();
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'edit')?.onSelect(mc);
    expect(ctx.edit).toHaveBeenCalledWith('n1');
    actionOf(items, 'child')?.onSelect(mc);
    expect(ctx.addChild).toHaveBeenCalledWith('n1');
    actionOf(items, 'sibling')?.onSelect(mc);
    expect(ctx.addSibling).toHaveBeenCalledWith('n1');
    actionOf(items, 'delete')?.onSelect(mc);
    expect(ctx.deleteNode).toHaveBeenCalledWith('n1');
  });
});
