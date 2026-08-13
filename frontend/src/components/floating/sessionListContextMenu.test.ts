// frontend/src/components/floating/sessionListContextMenu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSessionItems, type SessionMenuCtx } from './sessionListContextMenu';
import type { ProjectSessionSummary } from '@ai-task-flow/shared';
import type { MenuContext } from '@/components/context-menu/types';

function makeSession(o: Partial<ProjectSessionSummary> = {}): ProjectSessionSummary {
  return {
    sessionId: 's1',
    title: '会话1',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    messageCount: 3,
    source: 'windows',
    ...o,
  };
}

describe('buildSessionItems', () => {
  it('包含切换 + 复制恢复指令', () => {
    const ctx: SessionMenuCtx = { select: vi.fn(), copyResume: vi.fn() };
    const mc = { target: makeSession(), ctx } as MenuContext<
      ProjectSessionSummary,
      SessionMenuCtx
    >;
    const items = buildSessionItems(mc);
    expect(items.map((i) => i.key)).toEqual(['select', 'copyResume']);
  });

  it('切换 onSelect 带 source', () => {
    const select = vi.fn();
    const mc = {
      target: makeSession({ source: 'wsl' }),
      ctx: { select, copyResume: vi.fn() },
    } as MenuContext<ProjectSessionSummary, SessionMenuCtx>;
    buildSessionItems(mc)
      .find((i) => i.key === 'select')!
      // @ts-expect-error action onSelect
      .onSelect(mc);
    expect(select).toHaveBeenCalledWith('s1', 'wsl');
  });

  it('复制恢复指令 onSelect 带 sessionId', () => {
    const copyResume = vi.fn();
    const mc = {
      target: makeSession(),
      ctx: { select: vi.fn(), copyResume },
    } as MenuContext<ProjectSessionSummary, SessionMenuCtx>;
    buildSessionItems(mc)
      .find((i) => i.key === 'copyResume')!
      // @ts-expect-error action onSelect
      .onSelect(mc);
    expect(copyResume).toHaveBeenCalledWith('s1');
  });
});
