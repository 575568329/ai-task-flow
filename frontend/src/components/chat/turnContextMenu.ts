// frontend/src/components/chat/turnContextMenu.ts
// 聊天 turn 右键菜单（复制文本）。claude jsonl 时间线只读，只做复制。
import { Copy } from 'lucide-react';
import type { MenuItemBuilder } from '@/components/context-menu/types';

interface TurnTarget {
  text: string;
}

export interface TurnMenuCtx {
  copy: (text: string) => void;
}

export const buildTurnItems: MenuItemBuilder<TurnTarget, TurnMenuCtx> = ({ target, ctx }) => [
  {
    type: 'action',
    key: 'copy',
    label: '复制文本',
    icon: Copy,
    disabled: !target.text,
    onSelect: () => ctx.copy(target.text),
  },
];
