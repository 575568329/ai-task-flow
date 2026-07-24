// frontend/src/components/board/KanbanColumn.tsx
// 看板列:droppable 容器 + 列头(状态点/名称/计数),isOver 高亮。
// 列内卡片按 projectName 二次分组(可折叠),缓解「单列卡片纵向堆太多滚动很久」。
import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { TaskDTO } from '@ai-task-flow/shared';
import { ProjectGroup } from './ProjectGroup';
import { UNGROUPED_KEY, UNGROUPED_LABEL, type KanbanColumnDef } from './meta';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  column: KanbanColumnDef;
  tasks: TaskDTO[];
}

interface ProjectGroupItem {
  key: string;
  label: string;
  tasks: TaskDTO[];
}

export function KanbanColumn({ column, tasks }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  // 列内按 projectName 分组:有项目名按卡片数降序(主打项目置顶),未分组固定垫底。
  const groups = useMemo<ProjectGroupItem[]>(() => {
    const buckets = new Map<string, TaskDTO[]>();
    for (const task of tasks) {
      const key = task.projectName?.trim() ? task.projectName : UNGROUPED_KEY;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(task);
      else buckets.set(key, [task]);
    }
    return Array.from(buckets.entries())
      .map(([key, groupTasks]) => ({
        key,
        label: key === UNGROUPED_KEY ? UNGROUPED_LABEL : key,
        tasks: groupTasks,
      }))
      .sort((a, b) => {
        const aUn = a.key === UNGROUPED_KEY;
        const bUn = b.key === UNGROUPED_KEY;
        if (aUn !== bUn) return aUn ? 1 : -1; // 未分组排最后
        if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length; // 卡片多者在上
        return a.label.localeCompare(b.label); // 同数按名,稳定排序
      });
  }, [tasks]);

  return (
    // 列宽:min-w 保底可读 + flex-1 填满看板宽度。
    // 宽屏(≥3×260)时 3 列等分铺满;窄屏装不下时 min-w 撑超触发外层 overflow-x-auto 横滚。
    <div className="bg-muted/30 flex min-w-[260px] flex-1 flex-col rounded-lg">
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
        {groups.map((group) => (
          <ProjectGroup key={group.key} groupKey={group.key} label={group.label} tasks={group.tasks} />
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
