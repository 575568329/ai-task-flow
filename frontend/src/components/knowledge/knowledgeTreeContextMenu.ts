// frontend/src/components/knowledge/knowledgeTreeContextMenu.ts
// 知识库文件树右键菜单（打开/收藏/复制路径/编辑/删除）。导出PDF/下载依赖预览DOM，留 header。
import { FileText, Star, Copy, Pencil, Trash2 } from 'lucide-react';
import type { KnowledgeNode } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';

export interface KnowledgeNodeMenuCtx {
  open: (path: string) => void;
  toggleFav: (path: string) => void;
  copyPath: (path: string) => void;
  edit: (path: string) => void;
  remove: (path: string) => void;
  isFavorite: (path: string) => boolean;
}

export const buildKnowledgeNodeItems: MenuItemBuilder<KnowledgeNode, KnowledgeNodeMenuCtx> = ({
  target,
  ctx,
}) => {
  const isFile = target.type === 'file';
  // KnowledgeNode 是联合类型（file | dir），dir 无 path；narrowing 后取 path
  const path = target.type === 'file' ? target.path : '';
  return [
    {
      type: 'action',
      key: 'open',
      label: '打开',
      icon: FileText,
      hidden: !isFile,
      onSelect: () => ctx.open(path),
    },
    {
      type: 'action',
      key: 'fav',
      label: ctx.isFavorite(path) ? '取消收藏' : '收藏',
      icon: Star,
      hidden: !isFile,
      onSelect: () => ctx.toggleFav(path),
    },
    {
      type: 'action',
      key: 'copyPath',
      label: '复制磁盘路径',
      icon: Copy,
      hidden: !isFile,
      onSelect: () => ctx.copyPath(path),
    },
    { type: 'separator', key: 's1' },
    {
      type: 'action',
      key: 'edit',
      label: '编辑',
      icon: Pencil,
      hidden: !isFile,
      onSelect: () => ctx.edit(path),
    },
    { type: 'separator', key: 's2' },
    {
      type: 'action',
      key: 'delete',
      label: '删除文档',
      icon: Trash2,
      danger: true,
      hidden: !isFile,
      onSelect: () => ctx.remove(path),
    },
  ];
};
