// frontend/src/components/floating/sessionListContextMenu.ts
// 悬浮窗会话列表右键菜单（切换/复制恢复指令）。重命名/删除后端不支持，暂不放。
import { MessagesSquare, Copy } from 'lucide-react';
import type { ProjectSessionSummary } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';

export interface SessionMenuCtx {
  select: (sessionId: string, source: 'windows' | 'wsl') => void;
  copyResume: (sessionId: string) => void;
}

export const buildSessionItems: MenuItemBuilder<ProjectSessionSummary, SessionMenuCtx> = ({
  target,
  ctx,
}) => [
  {
    type: 'action',
    key: 'select',
    label: '切换到此会话',
    icon: MessagesSquare,
    onSelect: () => ctx.select(target.sessionId, target.source ?? 'windows'),
  },
  {
    type: 'action',
    key: 'copyResume',
    label: '复制恢复指令',
    icon: Copy,
    onSelect: () => ctx.copyResume(target.sessionId),
  },
];
