// frontend/src/lib/taskMeta.ts
import { TaskStatus, Priority } from '@ai-task-flow/shared';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PLANNING]: '待规划',
  [TaskStatus.TODO]: '待办',
  [TaskStatus.DISPATCHED]: '已派发',
  [TaskStatus.REVIEW]: '审核中',
  [TaskStatus.DONE]: '已完成',
  [TaskStatus.BLOCKED]: '已阻塞',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.PLANNING]: 'var(--status-planning)',
  [TaskStatus.TODO]: 'var(--status-todo)',
  [TaskStatus.DISPATCHED]: 'var(--status-dispatched)',
  [TaskStatus.REVIEW]: 'var(--status-review)',
  [TaskStatus.DONE]: 'var(--status-done)',
  [TaskStatus.BLOCKED]: 'var(--status-blocked)',
};

/** 看板列展示顺序 */
export const BOARD_COLUMNS: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.DISPATCHED,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
  TaskStatus.BLOCKED,
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  [Priority.P0]: 'var(--priority-p0)',
  [Priority.P1]: 'var(--priority-p1)',
  [Priority.P2]: 'var(--priority-p2)',
};

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
