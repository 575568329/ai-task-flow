// frontend/src/components/KanbanColumn.tsx
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Inbox } from 'lucide-react';
import type { TaskDTO, TaskStatus } from '@ai-task-flow/shared';
import { TaskCard } from './TaskCard';
import { Badge } from './ui/Tag';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/taskMeta';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: TaskDTO[];
  onTaskClick: (task: TaskDTO) => void;
}

export function KanbanColumn({ status, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className="flex max-h-[calc(100vh-140px)] min-w-[280px] flex-1 flex-col rounded-xl p-3 transition-colors"
      style={{
        background: 'var(--bg)',
        outline: isOver ? `2px dashed ${STATUS_COLORS[status]}` : 'none',
      }}
    >
      <div
        className="mb-3 flex items-center gap-2 border-b pb-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: STATUS_COLORS[status] }}
        />
        <h3 className="text-sm font-semibold">{STATUS_LABELS[status]}</h3>
        <Badge count={tasks.length} color={STATUS_COLORS[status]} />
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div
            className="flex flex-col items-center justify-center gap-2 py-8 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            <Inbox size={28} className="opacity-40" />
            暂无任务
          </div>
        )}
      </div>
    </div>
  );
}
