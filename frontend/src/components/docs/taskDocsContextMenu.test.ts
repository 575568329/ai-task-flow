// frontend/src/components/docs/taskDocsContextMenu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildTaskDocItems, type TaskDocMenuCtx } from './taskDocsContextMenu';
import { TaskStatus, type TaskDTO } from '@ai-task-flow/shared';
import type { MenuContext } from '@/components/context-menu/types';

function makeTask(o: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: 'WS-001',
    title: '任务',
    status: TaskStatus.TODO,
    priority: 'P1' as TaskDTO['priority'],
    source: 'manual',
    description: '',
    steps: [],
    createdAt: '',
    updatedAt: '',
    ...o,
  } as unknown as TaskDTO;
}

describe('buildTaskDocItems', () => {
  it('打开 + 复制路径；无 taskFilePath 时复制 disabled', () => {
    const ctx: TaskDocMenuCtx = { open: vi.fn(), copyPath: vi.fn() };
    const items = buildTaskDocItems({
      target: makeTask(),
      ctx,
    } as MenuContext<TaskDTO, TaskDocMenuCtx>);
    expect(items.map((i) => i.key)).toEqual(['open', 'copyPath']);
    const copy = items.find((i) => i.key === 'copyPath')!;
    expect(copy.type === 'action' && copy.disabled).toBe(true);
  });

  it('有 taskFilePath 时复制 enabled + onSelect 触发回调', () => {
    const open = vi.fn();
    const copyPath = vi.fn();
    const mc = {
      target: makeTask({ taskFilePath: '/path/to.md' }),
      ctx: { open, copyPath },
    } as MenuContext<TaskDTO, TaskDocMenuCtx>;
    const items = buildTaskDocItems(mc);
    const copy = items.find((i) => i.key === 'copyPath')!;
    expect(copy.type === 'action' && copy.disabled).toBe(false);
    if (copy.type === 'action') copy.onSelect(mc);
    expect(copyPath).toHaveBeenCalledWith('/path/to.md');
    const openItem = items.find((i) => i.key === 'open')!;
    if (openItem.type === 'action') openItem.onSelect(mc);
    expect(open).toHaveBeenCalledWith('WS-001');
  });
});
