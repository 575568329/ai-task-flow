// frontend/src/components/knowledge/knowledgeTreeContextMenu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildKnowledgeNodeItems, type KnowledgeNodeMenuCtx } from './knowledgeTreeContextMenu';
import type { KnowledgeNode } from '@ai-task-flow/shared';
import type { MenuContext } from '@/components/context-menu/types';

function makeNode(o: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    name: 'doc.md',
    path: 'doc.md',
    type: 'file',
    title: 'Doc',
    mtime: '',
    children: [],
    ...o,
  } as unknown as KnowledgeNode;
}

function setup(node?: Partial<KnowledgeNode>, ctxO?: Partial<KnowledgeNodeMenuCtx>) {
  const ctx: KnowledgeNodeMenuCtx = {
    open: vi.fn(),
    toggleFav: vi.fn(),
    copyPath: vi.fn(),
    edit: vi.fn(),
    remove: vi.fn(),
    isFavorite: () => false,
    ...ctxO,
  };
  return {
    ctx,
    mc: { target: makeNode(node), ctx } as MenuContext<KnowledgeNode, KnowledgeNodeMenuCtx>,
  };
}

describe('buildKnowledgeNodeItems', () => {
  it('文件节点：5 action + 2 分隔', () => {
    const { mc } = setup();
    const items = buildKnowledgeNodeItems(mc);
    expect(items.filter((i) => i.type === 'action')).toHaveLength(5);
    expect(items.filter((i) => i.type === 'separator')).toHaveLength(2);
  });

  it('目录节点：action 全 hidden', () => {
    const { mc } = setup({ type: 'dir' });
    const items = buildKnowledgeNodeItems(mc);
    expect(
      items
        .filter((i) => i.type === 'action')
        .every((a) => a.type === 'action' && a.hidden),
    ).toBe(true);
  });

  it('收藏标签随 isFavorite 变化', () => {
    const { mc } = setup({}, { isFavorite: () => true });
    const fav = buildKnowledgeNodeItems(mc).find((i) => i.key === 'fav')!;
    expect(fav.type === 'action' && fav.label).toBe('取消收藏');
  });

  it('action onSelect 触发对应回调', () => {
    const { ctx, mc } = setup();
    const items = buildKnowledgeNodeItems(mc);
    const call = (k: string) => {
      const it = items.find((i) => i.key === k);
      if (it && it.type === 'action') it.onSelect(mc);
    };
    call('open');
    expect(ctx.open).toHaveBeenCalledWith('doc.md');
    call('copyPath');
    expect(ctx.copyPath).toHaveBeenCalledWith('doc.md');
    call('delete');
    expect(ctx.remove).toHaveBeenCalledWith('doc.md');
  });

  it('删除项 danger=true', () => {
    const { mc } = setup();
    const del = buildKnowledgeNodeItems(mc).find((i) => i.key === 'delete')!;
    expect(del.type === 'action' && del.danger).toBe(true);
  });
});
