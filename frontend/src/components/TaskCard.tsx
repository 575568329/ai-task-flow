// frontend/src/components/TaskCard.tsx
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, GitBranch, Copy, Trash2 } from 'lucide-react';
import { buildClaudeCodePrompt, type TaskDTO } from '@ai-task-flow/shared';
import { Tag } from './ui/Tag';
import { toast } from './ui/Toaster';
import { useTaskStore } from '@/stores/taskStore';
import { PRIORITY_COLORS, relativeTime } from '@/lib/taskMeta';

interface TaskCardProps {
  task: TaskDTO;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const remove = useTaskStore((s) => s.remove);
  const [busy, setBusy] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: 'var(--bg-lower)',
    borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
  };

  // 复制派发指令——阻止冒泡,避免触发拖拽/打开抽屉
  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildClaudeCodePrompt(task));
      toast.success('派发指令已复制');
    } catch {
      toast.error('复制失败,请检查浏览器权限');
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`确认删除任务 ${task.id}?`)) return;
    setBusy(true);
    try {
      await remove(task.id);
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="group relative mb-2 cursor-pointer rounded-lg p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* hover 时右上角悬浮操作 */}
      <div
        className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        // 整块阻止指针事件冒泡,确保按钮区不会被拖拽监听吞掉
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleCopy}
          className="rounded p-1 shadow-sm transition-fast hover:opacity-80"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
          title="复制派发指令"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="rounded p-1 shadow-sm transition-fast hover:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--error-8)' }}
          title="删除任务"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          {task.id}
        </span>
        <Tag color={PRIORITY_COLORS[task.priority]} filled>
          {task.priority}
        </Tag>
      </div>

      <h4 className="mb-1.5 text-sm font-semibold leading-snug">{task.title}</h4>

      {task.description && (
        <p className="mb-2 line-clamp-2 text-xs" style={{ color: 'var(--text-2)' }}>
          {task.description}
        </p>
      )}

      {task.projectName && (
        <div className="mb-2 flex flex-wrap gap-1">
          <Tag>{task.projectName}</Tag>
        </div>
      )}

      <div
        className="flex items-center justify-between text-xs"
        style={{ color: 'var(--text-2)' }}
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
