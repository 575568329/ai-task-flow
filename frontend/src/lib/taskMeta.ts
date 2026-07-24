// frontend/src/lib/taskMeta.ts
import { TaskStatus, Priority } from '@ai-task-flow/shared';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: '待办',
  [TaskStatus.IN_PROGRESS]: '进行中',
  [TaskStatus.DONE]: '已完成',
  [TaskStatus.BLOCKED]: '已阻塞',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  [Priority.P0]: 'var(--error-6)',    // 红色 - 紧急
  [Priority.P1]: 'var(--warning-6)',  // 橙色 - 高
  [Priority.P2]: 'var(--grey-6)',     // 灰色 - 普通
};

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
