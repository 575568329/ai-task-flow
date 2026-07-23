// frontend/src/components/board/TaskCard.tsx
// 可拖拽任务卡片:点击打开 Drawer,整卡可拖(distance 阈值区分点击/拖拽)。
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { relativeTime } from '@/lib/taskMeta';
import { PRIORITY_BADGE, ENV_BADGE } from './meta';

interface TaskCardProps {
  task: TaskDTO;
}

export function TaskCard({ task }: TaskCardProps) {
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id });

  const priorityMeta = PRIORITY_BADGE[task.priority];
  const completedSteps = task.steps.filter((s) => s.completed).length;
  const totalSteps = task.steps.length;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      data-dragging={isDragging}
      onClick={() => setSelectedTask(task.id)}
      className="bg-card group data-[dragging=true]:opacity-40 flex cursor-pointer flex-col gap-1.5 rounded-md border p-2.5 shadow-sm transition-shadow hover:shadow-md"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="text-muted-foreground/0 group-hover:text-muted-foreground/50 mt-0.5 size-3.5 shrink-0" />
        <span className="text-foreground flex-1 text-sm leading-snug font-medium">
          {task.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 pl-5">
        <Badge variant={priorityMeta.variant} className="px-1.5 py-0 text-[10px]">
          {priorityMeta.label}
        </Badge>
        {task.source === 'web' && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">web</Badge>
        )}
        {task.env && (
          <Badge variant={ENV_BADGE[task.env].variant} className="px-1.5 py-0 text-[10px]">
            {ENV_BADGE[task.env].label}
          </Badge>
        )}
        {task.projectName && (
          <span className="text-muted-foreground truncate text-[10px]">{task.projectName}</span>
        )}
      </div>

      {totalSteps > 0 && (
        <div className="text-muted-foreground pl-5 text-[10px]">
          步骤 {completedSteps}/{totalSteps}
        </div>
      )}

      <div className="text-muted-foreground pl-5 text-[10px]">
        {relativeTime(task.updatedAt)}
      </div>
    </div>
  );
}
