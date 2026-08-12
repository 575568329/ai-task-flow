// frontend/src/components/mindmap/nodeContextMenu.test.ts
// 思维导图节点右键菜单项工厂测试：菜单结构、根禁用、折叠隐藏、颜色子菜单、回调触发。
import { describe, it, expect, vi } from 'vitest';
import { buildMindmapNodeItems, type MindmapMenuCtx } from './nodeContextMenu';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import type {
  MenuAction,
  MenuContext,
  MenuItemBuilder,
  MenuSubmenu,
} from '@/components/context-menu/types';

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
    setBranch: vi.fn(),
    hasChildren: () => false,
    ...o,
  };
}

function makeTarget(o: Partial<MindmapNodeData> = {}): Target {
  return { id: 'n1', data: { label: '节点', level: 1, expanded: true, ...o } };
}

type Items = ReturnType<MenuItemBuilder<Target, MindmapMenuCtx>>;

function actionOf(items: Items, key: string): MenuAction<Target, MindmapMenuCtx> | undefined {
  const it = items.find((i) => i.key === key);
  return it && it.type === 'action' ? it : undefined;
}

function submenuOf(items: Items, key: string): MenuSubmenu<Target, MindmapMenuCtx> | undefined {
  const it = items.find((i) => i.key === key);
  return it && it.type === 'submenu' ? it : undefined;
}

describe('buildMindmapNodeItems', () => {
  it('包含核心菜单项 + 3 个分隔符', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => true }),
    });
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(['edit', 'child', 'sibling', 'color', 'toggle', 'delete']),
    );
    expect(items.filter((i) => i.type === 'separator')).toHaveLength(3);
  });

  it('根节点(level 0)：删除与加同级 disabled', () => {
    const items = buildMindmapNodeItems({ target: makeTarget({ level: 0 }), ctx: makeCtx() });
    expect(actionOf(items, 'delete')?.disabled).toBe(true);
    expect(actionOf(items, 'sibling')?.disabled).toBe(true);
  });

  it('非根节点：删除与加同级 enabled', () => {
    const items = buildMindmapNodeItems({ target: makeTarget({ level: 2 }), ctx: makeCtx() });
    expect(actionOf(items, 'delete')?.disabled).toBe(false);
    expect(actionOf(items, 'sibling')?.disabled).toBe(false);
  });

  it('无子节点：折叠项 hidden', () => {
    const items = buildMindmapNodeItems({
      target: makeTarget(),
      ctx: makeCtx({ hasChildren: () => false }),
    });
    expect(actionOf(items, 'toggle')?.hidden).toBe(true);
  });

  it('有子节点：折叠项可见；collapsed 时 label 为"展开子节点"', () => {
    const expanded = buildMindmapNodeItems({
      target: makeTarget({ expanded: true }),
      ctx: makeCtx({ hasChildren: () => true }),
    });
    const collapsed = buildMindmapNodeItems({
      target: makeTarget({ expanded: false }),
      ctx: makeCtx({ hasChildren: () => true }),
    });
    expect(actionOf(expanded, 'toggle')?.hidden).toBe(false);
    expect(actionOf(collapsed, 'toggle')?.label).toBe('展开子节点');
  });

  it('颜色子菜单含 8 色，首色 onSelect 调 setBranch("blue")', () => {
    const setBranch = vi.fn();
    const ctx = makeCtx({ setBranch });
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    const color = submenuOf(items, 'color');
    expect(color).toBeDefined();
    const sub = typeof color!.items === 'function' ? color!.items(mc) : color!.items;
    expect(sub).toHaveLength(8);
    expect(sub.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'blue',
        'teal',
        'emerald',
        'amber',
        'orange',
        'rose',
        'violet',
        'indigo',
      ]),
    );
    const first = sub[0];
    if (first.type === 'action') first.onSelect(mc);
    expect(setBranch).toHaveBeenCalledWith('n1', 'blue');
  });

  it('各 action onSelect 触发对应 ctx 回调', () => {
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

  it('toggle onSelect 调 toggleExpand', () => {
    const ctx = makeCtx({ hasChildren: () => true });
    const mc: MenuContext<Target, MindmapMenuCtx> = { target: makeTarget(), ctx };
    const items = buildMindmapNodeItems(mc);
    actionOf(items, 'toggle')?.onSelect(mc);
    expect(ctx.toggleExpand).toHaveBeenCalledWith('n1');
  });
});
