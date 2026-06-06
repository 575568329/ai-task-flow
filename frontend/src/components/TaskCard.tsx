// frontend/src/components/TaskCard.tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, GitBranch } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import { Tag } from './ui/Tag';
import { PRIORITY_COLORS, relativeTime } from '@/lib/taskMeta';

interface TaskCardProps {
  task: TaskDTO;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: 'var(--surface)',
    borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="mb-2 cursor-pointer rounded-lg p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          {task.id}
        </span>
        <Tag color={PRIORITY_COLORS[task.priority]} filled>
          {task.priority}
        </Tag>
      </div>

      <h4 className="mb-1.5 text-sm font-semibold leading-snug">{task.title}</h4>

      {task.description && (
        <p className="mb-2 line-clamp-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {task.description}
        </p>
      )}

      {task.projects.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.projects.map((p) => (
            <Tag key={p}>{p}</Tag>
          ))}
        </div>
      )}

      <div
        className="flex items-center justify-between text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {relativeTime(task.updatedAt)}
        </span>
        {task.worktree && (
          <span className="flex items-center gap-1">
            <GitBranch size={12} />
            {task.worktree.branch}
          </span>
        )}
      </div>
    </div>
  );
}
