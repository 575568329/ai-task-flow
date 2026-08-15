// frontend/src/components/mindmap/canvasContextMenu.ts
// 画布右键菜单（右键画布空白处）：自动布局 / 适应视图 / 网格开关 / 导出 PNG。
import { Sparkles, Maximize, Download, Grid3x3, EyeOff } from 'lucide-react';
import type { MenuItemBuilder } from '@/components/context-menu/types';

/** 画布右键上下文（由 MindmapEditor 注入） */
export interface MindmapCanvasCtx {
  autoLayout: () => void;
  fitView: () => void;
  exportPng: () => void;
  /** 网格显示状态（菜单项 label 随之切换） */
  showGrid: boolean;
  toggleGrid: () => void;
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
  {
    type: 'action',
    key: 'grid',
    label: ctx.showGrid ? '隐藏网格' : '显示网格',
    icon: ctx.showGrid ? EyeOff : Grid3x3,
    onSelect: () => ctx.toggleGrid(),
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
