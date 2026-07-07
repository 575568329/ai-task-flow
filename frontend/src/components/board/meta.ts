// frontend/src/components/board/meta.ts
// 看板视图私有元数据:列顺序/配色 + 优先级 badge 映射。
// 不复用 lib/taskMeta 的 STATUS_COLORS(那是旧 Spark 变量,新 shadcn 体系无定义);
// 此处配色用 Tailwind 默认调色板 class,与 shadcn slate 主题协调。
import { TaskStatus, Priority } from '@ai-task-flow/shared';
import { STATUS_LABELS } from '@/lib/taskMeta';

export interface KanbanColumnDef {
  status: TaskStatus;
  label: string;
  dotClass: string;
}

// 看板列顺序(5 列,横向滚动)
export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { status: TaskStatus.TODO, label: STATUS_LABELS[TaskStatus.TODO], dotClass: 'bg-blue-500' },
  { status: TaskStatus.DISPATCHED, label: STATUS_LABELS[TaskStatus.DISPATCHED], dotClass: 'bg-amber-500' },
  { status: TaskStatus.REVIEW, label: STATUS_LABELS[TaskStatus.REVIEW], dotClass: 'bg-violet-500' },
  { status: TaskStatus.DONE, label: STATUS_LABELS[TaskStatus.DONE], dotClass: 'bg-emerald-500' },
  { status: TaskStatus.BLOCKED, label: STATUS_LABELS[TaskStatus.BLOCKED], dotClass: 'bg-rose-500' },
];

type BadgeVariant = 'destructive' | 'default' | 'secondary';

export const PRIORITY_BADGE: Record<Priority, { variant: BadgeVariant; label: string }> = {
  [Priority.P0]: { variant: 'destructive', label: 'P0' },
  [Priority.P1]: { variant: 'default', label: 'P1' },
  [Priority.P2]: { variant: 'secondary', label: 'P2' },
};

/** Select 组件「全部」选项的哨兵值(Radix Select 不允许空字符串 value) */
export const ALL_OPTION = '__all__';
