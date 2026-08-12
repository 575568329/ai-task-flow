// frontend/src/components/mindmap/canvasContextMenu.ts
// 思维导图画布右键菜单（右键画布空白处）：自动布局 / 适应视图 / 导出 PNG。
import { Sparkles, Maximize, Download } from 'lucide-react';
import type { MenuItemBuilder } from '@/components/context-menu/types';

/** 画布右键上下文（由 MindmapEditor 注入） */
export interface MindmapCanvasCtx {
  autoLayout: () => void;
  fitView: () => void;
  exportPng: () => void;
}

/** 画布右键菜单项工厂（无特定 target，target 固定 null） */
export const buildCanvasItems: MenuItemBuilder<null, MindmapCanvasCtx> = ({ ctx }) => [
  {
    type: 'action',
    key: 'layout',
    label: '自动布局',
    icon: Sparkles,
    onSelect: () => ctx.autoLayout(),
  },
  {
    type: 'action',
    key: 'fit',
    label: '适应视图',
    icon: Maximize,
    onSelect: () => ctx.fitView(),
  },
  { type: 'separator', key: 's1' },
  {
    type: 'action',
    key: 'export',
    label: '导出 PNG',
    icon: Download,
    onSelect: () => ctx.exportPng(),
  },
];
