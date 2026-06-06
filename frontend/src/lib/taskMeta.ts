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
  [TaskStatus.PLANNING]: 'var(--grey-6)',      // 中性灰
  [TaskStatus.TODO]: 'var(--primary-6)',       // 蓝色
  [TaskStatus.DISPATCHED]: 'var(--warning-6)', // 橙色
  [TaskStatus.REVIEW]: 'var(--primary-8)',     // 深蓝
  [TaskStatus.DONE]: 'var(--success-6)',       // 绿色
  [TaskStatus.BLOCKED]: 'var(--error-6)',      // 红色
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
