// frontend/src/components/board/meta.ts
// 看板视图私有元数据:列顺序/配色 + 优先级 badge 映射。
// 不复用 lib/taskMeta 的 STATUS_COLORS(那是旧 Spark 变量,新 shadcn 体系无定义);
// 此处配色用 Tailwind 默认调色板 class,与 shadcn slate 主题协调。
import { TaskStatus, Priority, type TaskEnv } from '@ai-task-flow/shared';
import { STATUS_LABELS } from '@/lib/taskMeta';

export interface KanbanColumnDef {
  status: TaskStatus;
  label: string;
  dotClass: string;
}

// 看板列顺序(4 列,横向铺满):待办 / 进行中 / 已完成 / 已阻塞。
// 进行中:Claude 通过 MCP complete_step 回写步骤完成后,任务自动从待办推进到进行中。
export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { status: TaskStatus.TODO, label: STATUS_LABELS[TaskStatus.TODO], dotClass: 'bg-blue-500' },
  { status: TaskStatus.IN_PROGRESS, label: STATUS_LABELS[TaskStatus.IN_PROGRESS], dotClass: 'bg-amber-500' },
  { status: TaskStatus.DONE, label: STATUS_LABELS[TaskStatus.DONE], dotClass: 'bg-emerald-500' },
  { status: TaskStatus.BLOCKED, label: STATUS_LABELS[TaskStatus.BLOCKED], dotClass: 'bg-rose-500' },
];

type BadgeVariant = 'destructive' | 'default' | 'secondary';

/** 终端环境 badge 映射(TaskCard 上显示任务级 env 偏好) */
export const ENV_BADGE: Record<TaskEnv, { variant: BadgeVariant; label: string }> = {
  cmd: { variant: 'secondary', label: 'cmd' },
  wsl: { variant: 'secondary', label: 'wsl' },
  pwsh: { variant: 'secondary', label: 'pwsh' },
};

export const PRIORITY_BADGE: Record<Priority, { variant: BadgeVariant; label: string }> = {
  [Priority.P0]: { variant: 'destructive', label: 'P0' },
  [Priority.P1]: { variant: 'default', label: 'P1' },
  [Priority.P2]: { variant: 'secondary', label: 'P2' },
};

/** Select 组件「全部」选项的哨兵值(Radix Select 不允许空字符串 value) */
export const ALL_OPTION = '__all__';

/** 未填写 projectName 的任务归入此分组 key,UI 显示为「未分组」。 */
export const UNGROUPED_KEY = '__ungrouped__';
export const UNGROUPED_LABEL = '未分组';
