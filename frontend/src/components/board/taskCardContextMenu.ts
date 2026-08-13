// frontend/src/components/board/taskCardContextMenu.ts
// 看板任务卡右键菜单项工厂（数据驱动，复用通用 ContextMenuHost）。
import { ExternalLink, MessageSquare, Terminal, Copy, Hash, ArrowRightLeft, Flag, Trash2 } from 'lucide-react';
import { TaskStatus, Priority, type TaskDTO } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';
import { KANBAN_COLUMNS } from './meta';
import { STATUS_LABELS } from '@/lib/taskMeta';

/** 任务卡右键上下文（回调集合，由 TaskCard 注入） */
export interface TaskCardMenuCtx {
  openDetail: (id: string) => void;
  openChat: (repoPath: string) => void;
  openTerminal: () => void;
  copyPrompt: (task: TaskDTO) => void;
  copyId: (id: string) => void;
  moveStatus: (id: string, status: TaskStatus) => void;
  setPriority: (id: string, priority: Priority) => void;
  removeTask: (task: TaskDTO) => void;
}

const PRIORITY_OPTIONS: { key: Priority; label: string }[] = [
  { key: Priority.P0, label: 'P0 紧急' },
  { key: Priority.P1, label: 'P1 高' },
  { key: Priority.P2, label: 'P2 普通' },
];

/** 任务卡右键菜单项工厂 */
export const buildTaskCardItems: MenuItemBuilder<TaskDTO, TaskCardMenuCtx> = ({
  target,
  ctx,
}) => [
  {
    type: 'action',
    key: 'detail',
    label: '打开 / 编辑详情',
    icon: ExternalLink,
    onSelect: () => ctx.openDetail(target.id),
  },
  {
    type: 'action',
    key: 'chat',
    label: '在悬浮窗对话',
    icon: MessageSquare,
    disabled: !target.repoPath,
    onSelect: () => target.repoPath && ctx.openChat(target.repoPath),
  },
  {
    type: 'action',
    key: 'terminal',
    label: '打开终端 / 派发',
    icon: Terminal,
    disabled: !target.repoPath,
    onSelect: () => ctx.openTerminal(),
  },
  { type: 'separator', key: 's1' },
  {
    type: 'action',
    key: 'copyPrompt',
    label: '复制执行指令',
    icon: Copy,
    onSelect: () => ctx.copyPrompt(target),
  },
  {
    type: 'action',
    key: 'copyId',
    label: '复制任务 ID',
    icon: Hash,
    onSelect: () => ctx.copyId(target.id),
  },
  { type: 'separator', key: 's2' },
  {
    type: 'submenu',
    key: 'status',
    label: '修改状态',
    icon: ArrowRightLeft,
    items: KANBAN_COLUMNS.map((c) => ({
      type: 'action' as const,
      key: String(c.status),
      label: STATUS_LABELS[c.status],
      disabled: target.status === c.status,
      onSelect: () => ctx.moveStatus(target.id, c.status),
    })),
  },
  {
    type: 'submenu',
    key: 'priority',
    label: '修改优先级',
    icon: Flag,
    items: PRIORITY_OPTIONS.map((p) => ({
      type: 'action' as const,
      key: String(p.key),
      label: p.label,
      disabled: target.priority === p.key,
      onSelect: () => ctx.setPriority(target.id, p.key),
    })),
  },
  { type: 'separator', key: 's3' },
  {
    type: 'action',
    key: 'delete',
    label: '删除任务',
    icon: Trash2,
    danger: true,
    onSelect: () => ctx.removeTask(target),
  },
];
