// frontend/src/components/board/KanbanColumn.tsx
// 看板列:droppable 容器 + 列头(状态点/名称/计数),isOver 高亮。
import { useDroppable } from '@dnd-kit/core';
import type { TaskDTO } from '@ai-task-flow/shared';
import { TaskCard } from './TaskCard';
import type { KanbanColumnDef } from './meta';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  column: KanbanColumnDef;
  tasks: TaskDTO[];
}

export function KanbanColumn({ column, tasks }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  return (
    <div className="bg-muted/30 flex w-72 shrink-0 flex-col rounded-lg">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn('size-2 rounded-full', column.dotClass)} />
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="text-muted-foreground ml-auto text-xs">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors',
          isOver && 'bg-primary/5'
        )}
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <div className="text-muted-foreground/50 rounded-md border border-dashed py-6 text-center text-xs">
            拖拽任务到此处
          </div>
        )}
      </div>
    </div>
  );
}
