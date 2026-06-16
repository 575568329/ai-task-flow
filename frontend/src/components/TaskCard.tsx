// frontend/src/components/TaskCard.tsx
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, GitBranch, Copy, Trash2, Send } from 'lucide-react';
import { buildClaudeCodePrompt, type TaskDTO } from '@ai-task-flow/shared';
import { Tag } from './ui/Tag';
import { toast } from './ui/Toaster';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useTaskStore } from '@/stores/taskStore';
import { PRIORITY_COLORS, STATUS_COLORS, relativeTime } from '@/lib/taskMeta';

interface TaskCardProps {
  task: TaskDTO;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const remove = useTaskStore((s) => s.remove);
  const dispatch = useTaskStore((s) => s.dispatch);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: 'var(--bg-lower)',
    borderLeft: `3px solid ${STATUS_COLORS[task.status]}`,
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

  // 派发任务（创建 worktree）并自动复制指令
  async function handleDispatch(e: React.MouseEvent) {
    e.stopPropagation();

    if (!task.repoPath) {
      toast.error('请先设置项目路径');
      return;
    }

    setBusy(true);
    try {
      await dispatch(task.id);

      // 派发成功后自动复制指令
      const prompt = buildClaudeCodePrompt(task);
      await navigator.clipboard.writeText(prompt);

      toast.success('派发成功！指令已复制，请粘贴给 Claude');
    } catch (err: any) {
      toast.error(`派发失败: ${err.message || '未知错误'}`);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmOpen(true);
  }

  async function confirmDelete() {
    setConfirmOpen(false);
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

  // 只有 todo 状态的任务才显示派发按钮
  const canDispatch = task.status === 'todo';

  // 解析 sourceUrl 的域名用于 web 来源角标;非法/缺失 URL 回退"网页"
  function safeHostname(url?: string): string {
    try { return url ? new URL(url).hostname : '网页'; } catch { return '网页'; }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="relative mb-2 cursor-pointer rounded-lg p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* 顶部:ID + 优先级 tag(右上角独占) */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          {task.id}
        </span>
        <Tag color={PRIORITY_COLORS[task.priority]} filled>
          {task.priority}
        </Tag>
      </div>

      <h4 className="mb-1.5 text-sm font-semibold leading-snug">{task.title}</h4>

      {/* 来源角标:仅 web 来源显示网页域名(manual 来源由下方 projectName Tag 标识,避免重复) */}
      {task.source === 'web' && (
        <div className="mb-1.5 flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
          <span className="inline-flex items-center gap-1" title={task.sourceUrl}>
            🌐 {safeHostname(task.sourceUrl)}
          </span>
        </div>
      )}

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

      {/* 底部:左侧元信息(时间/分支),右侧常驻操作按钮 */}
      <div
        className="flex items-center justify-between gap-2 text-xs"
        style={{ color: 'var(--text-2)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Clock size={12} />
            {relativeTime(task.updatedAt)}
          </span>
          {task.worktree && (
            <span className="flex items-center gap-1 truncate">
              <GitBranch size={12} />
              <span className="truncate">{task.worktree.branch}</span>
            </span>
          )}
        </div>

        {/* 常驻操作按钮(不再 hover 显隐),阻止指针事件冒泡避免触发拖拽 */}
        <div className="flex shrink-0 gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {canDispatch && (
            <button
              onClick={handleDispatch}
              disabled={busy}
              className="rounded p-1 shadow-sm transition-all hover:scale-110 disabled:opacity-40"
              style={{ backgroundColor: 'var(--primary-3)', color: 'var(--primary-9)' }}
              title="派发任务：创建独立 worktree 并复制指令"
            >
              <Send size={13} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="rounded p-1 shadow-sm transition-all hover:scale-110 hover:shadow-md"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
            title="复制指令：直接复制任务文件路径（无需派发）"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="rounded p-1 shadow-sm transition-all hover:scale-110 hover:shadow-md disabled:opacity-40"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--error-8)' }}
            title="删除任务"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="删除任务"
        danger
        confirmText="删除"
        message={
          <>
            确定删除任务 <b>{task.id}</b> 吗？此操作无法恢复。
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
