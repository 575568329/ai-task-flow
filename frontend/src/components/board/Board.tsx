// frontend/src/components/board/Board.tsx
// 看板主体:DndContext + 5 列,拖拽跨列 = optimisticMove 改 status。
// 应用 BoardToolbar 的筛选(project/source/search)。
import { useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core';
import { TaskStatus } from '@ai-task-flow/shared';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/components/ui/Toaster';
import { KanbanColumn } from './KanbanColumn';
import { KANBAN_COLUMNS } from './meta';

export function Board() {
  const tasks = useTaskStore((s) => s.tasks);
  const optimisticMove = useTaskStore((s) => s.optimisticMove);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const sourceFilter = useUIStore((s) => s.sourceFilter);
  const searchQuery = useUIStore((s) => s.searchQuery);

  // distance 8px:小于阈值算点击(打开 Drawer),超过算拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (projectFilter && task.projectName !== projectFilter) return false;
      if (sourceFilter && task.source !== sourceFilter) return false;
      if (query) {
        const haystack = `${task.title} ${task.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [tasks, projectFilter, sourceFilter, searchQuery]);

  const tasksOfStatus = (status: TaskStatus) =>
    filtered.filter((task) => task.status === status);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    // over.id 必须是某列 status(拖到列容器);防御性校验,避免非法 status
    // 把任务设成不存在的列导致它从看板"消失"
    const targetStatus = over.id as TaskStatus;
    if (!KANBAN_COLUMNS.some((c) => c.status === targetStatus)) return;
    if (task.status === targetStatus) return;
    try {
      await optimisticMove(taskId, targetStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移动失败,已回滚');
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3">
        {KANBAN_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.status}
            column={column}
            tasks={tasksOfStatus(column.status)}
          />
        ))}
      </div>
    </DndContext>
  );
}
