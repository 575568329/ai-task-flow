// frontend/src/components/board/TaskCard.tsx
// 可拖拽任务卡片:点击打开 Drawer,整卡可拖(distance 阈值区分点击/拖拽)。
// 视觉抽到 TaskCardBody 供 Board 的 DragOverlay 复用——拖拽预览 portal 到 body,
// 脱离原列的 overflow 裁切与 stacking context,根治「拖拽时卡片被列头遮挡」。
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

  return (
    <div
      ref={setNodeRef}
      // DragOverlay 接管位移后,原卡片拖拽中应静止(仅 opacity-40 占位);
      // 否则原卡片会随 transform 飘走、与 overlay 叠飘,列表留洞。
      style={{ transform: isDragging ? undefined : CSS.Translate.toString(transform) }}
      data-dragging={isDragging}
      onClick={() => setSelectedTask(task.id)}
      className="bg-card group data-[dragging=true]:opacity-40 flex cursor-pointer flex-col gap-1.5 rounded-md border p-2.5 shadow-sm transition-shadow hover:shadow-md"
      {...attributes}
      {...listeners}
    >
      <TaskCardBody task={task} />
    </div>
  );
}

/** 卡片纯展示:被 TaskCard 与 Board 的 DragOverlay 共用,本身不含拖拽逻辑 */
export function TaskCardBody({ task }: { task: TaskDTO }) {
  const priorityMeta = PRIORITY_BADGE[task.priority];
  const completedSteps = task.steps.filter((s) => s.completed).length;
  const totalSteps = task.steps.length;

  return (
    <>
      <div className="flex items-start gap-1.5">
        <GripVertical className="text-muted-foreground/0 group-hover:text-muted-foreground/50 mt-0.5 size-3.5 shrink-0" />
        <span className="text-foreground flex-1 text-sm leading-snug font-medium">
          {task.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 pl-5">
        <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
          {task.id}
        </Badge>
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
    </>
  );
}
