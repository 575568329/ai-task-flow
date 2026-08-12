// frontend/src/components/board/taskCardContextMenu.test.ts
// 任务卡右键菜单工厂测试。
import { describe, it, expect, vi } from 'vitest';
import { buildTaskCardItems, type TaskCardMenuCtx } from './taskCardContextMenu';
import { TaskStatus, Priority, type TaskDTO } from '@ai-task-flow/shared';
import type { MenuContext } from '@/components/context-menu/types';

function makeTask(o: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: 'WS-001',
    title: '测试任务',
    status: TaskStatus.TODO,
    priority: Priority.P1,
    source: 'manual',
    description: '',
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  } as TaskDTO;
}

function setup(task?: Partial<TaskDTO>) {
  const ctx: TaskCardMenuCtx = {
    openDetail: vi.fn(),
    openChat: vi.fn(),
    openTerminal: vi.fn(),
    copyPrompt: vi.fn(),
    copyId: vi.fn(),
    removeTask: vi.fn(),
  };
  const mc = { target: makeTask(task), ctx } as MenuContext<TaskDTO, TaskCardMenuCtx>;
  return { ctx, mc };
}

describe('buildTaskCardItems', () => {
  it('包含核心菜单项 + 2 分隔符', () => {
    const { mc } = setup();
    const items = buildTaskCardItems(mc);
    expect(items.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'detail',
        'chat',
        'terminal',
        'copyPrompt',
        'copyId',
        'delete',
      ]),
    );
    expect(items.filter((i) => i.type === 'separator')).toHaveLength(2);
  });

  it('无 repoPath：对话/终端 disabled', () => {
    const { mc } = setup({ repoPath: undefined });
    const items = buildTaskCardItems(mc);
    const chat = items.find((i) => i.key === 'chat')!;
    const terminal = items.find((i) => i.key === 'terminal')!;
    expect(chat.type === 'action' && chat.disabled).toBe(true);
    expect(terminal.type === 'action' && terminal.disabled).toBe(true);
  });

  it('有 repoPath：对话/终端 enabled', () => {
    const { mc } = setup({ repoPath: '/repo' });
    const items = buildTaskCardItems(mc);
    const chat = items.find((i) => i.key === 'chat')!;
    expect(chat.type === 'action' && chat.disabled).toBe(false);
  });

  it('各 action onSelect 触发对应回调', () => {
    const { ctx, mc } = setup();
    const items = buildTaskCardItems(mc);
    const call = (k: string) => {
      const it = items.find((i) => i.key === k);
      if (it && it.type === 'action') it.onSelect(mc);
    };
    call('detail');
    expect(ctx.openDetail).toHaveBeenCalledWith('WS-001');
    call('copyId');
    expect(ctx.copyId).toHaveBeenCalledWith('WS-001');
    call('copyPrompt');
    expect(ctx.copyPrompt).toHaveBeenCalled();
    call('delete');
    expect(ctx.removeTask).toHaveBeenCalled();
  });

  it('删除项 danger=true', () => {
    const { mc } = setup();
    const items = buildTaskCardItems(mc);
    const del = items.find((i) => i.key === 'delete')!;
    expect(del.type === 'action' && del.danger).toBe(true);
  });
});
