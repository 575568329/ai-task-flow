// frontend/src/components/board/TaskCard.tsx
// 可拖拽任务卡片:点击打开 Drawer,整卡可拖(distance 阈值区分点击/拖拽),右键菜单。
// 视觉抽到 TaskCardBody 供 Board 的 DragOverlay 复用——拖拽预览 portal 到 body,
// 脱离原列的 overflow 裁切与 stacking context,根治「拖拽时卡片被列头遮挡」。
import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MessageSquare } from 'lucide-react';
import { buildTaskPrompt, type TaskDTO } from '@ai-task-flow/shared';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { useTaskStore } from '@/stores/taskStore';
import { useConfirm } from '@/components/ui/confirm';
import { toast } from '@/components/ui/toaster';
import { relativeTime } from '@/lib/taskMeta';
import { PRIORITY_BADGE, ENV_BADGE } from './meta';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildTaskCardItems, type TaskCardMenuCtx } from './taskCardContextMenu';
import { OpenClaudeDialog } from './OpenClaudeDialog';

interface TaskCardProps {
  task: TaskDTO;
}

export function TaskCard({ task }: TaskCardProps) {
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const openForRepo = useProjectChatStore((s) => s.openForRepo);
  const optimisticMove = useTaskStore((s) => s.optimisticMove);
  const updateTaskAction = useTaskStore((s) => s.update);
  const removeTaskAction = useTaskStore((s) => s.remove);
  const { confirm } = useConfirm();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id });

  // 右键菜单上下文：回调就地构造（保持 TaskCardProps 不变）
  const menuCtx: TaskCardMenuCtx = {
    openDetail: (id) => setSelectedTask(id),
    openChat: (repoPath) => openForRepo(repoPath),
    openTerminal: () => setTerminalOpen(true),
    copyPrompt: (t) =>
      navigator.clipboard.writeText(buildTaskPrompt(t)).then(
        () => toast.success('执行指令已复制'),
        () => toast.error('复制失败'),
      ),
    copyId: (id) =>
      navigator.clipboard.writeText(id).then(
        () => toast.success('任务 ID 已复制'),
        () => toast.error('复制失败'),
      ),
    moveStatus: (id, status) => {
      optimisticMove(id, status).catch((e) =>
        toast.error(e instanceof Error ? e.message : '移动失败,已回滚'),
      );
    },
    setPriority: (id, priority) => {
      updateTaskAction(id, { priority }).catch((e) =>
        toast.error(e instanceof Error ? e.message : '修改优先级失败'),
      );
    },
    removeTask: async (t) => {
      if (
        !(await confirm({
          title: '删除任务',
          description: `确认删除「${t.title}」?此操作不可撤销。`,
          confirmText: '删除',
          variant: 'destructive',
        }))
      )
        return;
      removeTaskAction(t.id).then(
        () => toast.success('已删除'),
        (e: unknown) => toast.error(e instanceof Error ? e.message : '删除失败'),
      );
    },
  };

  return (
    <>
      <ContextMenuHost items={buildTaskCardItems} target={task} ctx={menuCtx}>
      <div
        ref={setNodeRef}
        // DragOverlay 接管位移后,原卡片拖拽中应静止(仅 opacity-40 占位);
        // 否则原卡片会随 transform 飘走、与 overlay 叠飘,列表留洞。
        style={{ transform: isDragging ? undefined : CSS.Translate.toString(transform) }}
        data-dragging={isDragging}
        onClick={() => setSelectedTask(task.id)}
        onContextMenu={(e) => e.stopPropagation()}
        className="bg-card group data-[dragging=true]:opacity-40 relative flex cursor-pointer flex-col gap-1.5 rounded-md border p-2.5 shadow-sm transition-shadow hover:shadow-md"
        {...attributes}
        {...listeners}
      >
        {/* 浮窗对话入口:hover 显示,点击直接开浮窗(不开 drawer);
            onPointerDown/onClick stopPropagation 阻止冒泡到卡片拖拽与点击 */}
        <button
          type="button"
          disabled={!task.repoPath}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (task.repoPath) openForRepo(task.repoPath);
          }}
          className="hover:bg-accent absolute right-1.5 top-1.5 z-10 inline-flex size-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="在悬浮窗中对话"
          title={task.repoPath ? '在悬浮窗中对话' : '该任务未填写仓库路径,无法对话'}
        >
          <MessageSquare className="size-3.5" />
        </button>
        <TaskCardBody task={task} />
      </div>
      </ContextMenuHost>
      {/* 右键「打开终端」受控弹窗（portal Dialog,放 Host 外避免 children 多元素） */}
      <OpenClaudeDialog
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        repoPath={task.repoPath}
        env={task.env ?? 'pwsh'}
      />
    </>
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
