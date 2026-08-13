// frontend/src/components/docs/taskDocsContextMenu.ts
// 任务文档列表项右键菜单（打开/复制磁盘路径）。导出PDF/下载依赖选中态，留 header。
import { FileText, Copy } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';

export interface TaskDocMenuCtx {
  open: (id: string) => void;
  copyPath: (taskFilePath?: string) => void;
}

export const buildTaskDocItems: MenuItemBuilder<TaskDTO, TaskDocMenuCtx> = ({ target, ctx }) => [
  {
    type: 'action',
    key: 'open',
    label: '打开',
    icon: FileText,
    onSelect: () => ctx.open(target.id),
  },
  {
    type: 'action',
    key: 'copyPath',
    label: '复制磁盘路径',
    icon: Copy,
    disabled: !target.taskFilePath,
    onSelect: () => ctx.copyPath(target.taskFilePath),
  },
];
