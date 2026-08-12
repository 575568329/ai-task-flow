// frontend/src/components/mindmap/nodeContextMenu.ts
// 思维导图节点右键菜单项工厂（数据驱动）。
// 复用 useMindmapActions 的加子/加同级/删子树/折叠 + updateNodeData 改色 + 本地 setEditing 编辑。
// 零新业务逻辑，只把已有操作组织成菜单项。
import { Pencil, Plus, Trash2, Palette, ChevronDown, ChevronRight } from 'lucide-react';
import type { BranchKey, MindmapNodeData } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';

/** 思维导图右键上下文（回调集合，由 MindmapNode 构造注入） */
export interface MindmapMenuCtx {
  edit: (id: string) => void;
  addChild: (id: string) => void;
  addSibling: (id: string) => void;
  deleteNode: (id: string) => void;
  toggleExpand: (id: string) => void;
  setBranch: (id: string, branch: BranchKey) => void;
  hasChildren: (id: string) => boolean;
}

/** 菜单目标：节点 id + data */
interface MindmapNodeTarget {
  id: string;
  data: MindmapNodeData;
}

/** 8 色定义（与 index.css 的 --branch-* 对应） */
const BRANCH_COLORS: { key: BranchKey; label: string }[] = [
  { key: 'blue', label: '蓝' },
  { key: 'teal', label: '青' },
  { key: 'emerald', label: '绿' },
  { key: 'amber', label: '琥珀' },
  { key: 'orange', label: '橙' },
  { key: 'rose', label: '玫红' },
  { key: 'violet', label: '紫' },
  { key: 'indigo', label: '靛' },
];

/** 节点右键菜单项工厂 */
export const buildMindmapNodeItems: MenuItemBuilder<MindmapNodeTarget, MindmapMenuCtx> = ({
  target,
  ctx,
}) => {
  const { id, data } = target;
  const isRoot = (data.level ?? 1) === 0;
  const collapsed = data.expanded === false;
  return [
    {
      type: 'action',
      key: 'edit',
      label: '编辑文本',
      icon: Pencil,
      onSelect: () => ctx.edit(id),
    },
    { type: 'separator', key: 's1' },
    {
      type: 'action',
      key: 'child',
      label: '添加子节点',
      icon: Plus,
      shortcut: 'Tab',
      onSelect: () => ctx.addChild(id),
    },
    {
      type: 'action',
      key: 'sibling',
      label: '添加同级节点',
      icon: Plus,
      shortcut: 'Enter',
      disabled: isRoot,
      onSelect: () => ctx.addSibling(id),
    },
    { type: 'separator', key: 's2' },
    {
      type: 'submenu',
      key: 'color',
      label: '分支颜色',
      icon: Palette,
      items: BRANCH_COLORS.map((c) => ({
        type: 'action' as const,
        key: c.key,
        label: c.label,
        onSelect: () => ctx.setBranch(id, c.key),
      })),
    },
    {
      type: 'action',
      key: 'toggle',
      label: collapsed ? '展开子节点' : '折叠子节点',
      icon: collapsed ? ChevronRight : ChevronDown,
      hidden: !ctx.hasChildren(id),
      onSelect: () => ctx.toggleExpand(id),
    },
    { type: 'separator', key: 's3' },
    {
      type: 'action',
      key: 'delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      disabled: isRoot,
      onSelect: () => ctx.deleteNode(id),
    },
  ];
};
