// frontend/src/components/board/KanbanColumn.tsx
// 看板列:droppable 容器 + 列头(状态点/名称/计数),isOver 高亮。
// 列内卡片按 projectName 二次分组(可折叠),缓解「单列卡片纵向堆太多滚动很久」。
// 紧凑(行形态,uTools 802 等):列头可点击展开/收起整行,空行默认收起省高度,
// 手动操作按状态记忆 localStorage;宽屏(列形态)不收起。
import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import { ProjectGroup } from './ProjectGroup';
import { UNGROUPED_KEY, UNGROUPED_LABEL, type KanbanColumnDef } from './meta';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
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

const ROW_COLLAPSED_KEY = 'ai-task-flow:board-row-collapsed:v1';

/** 读取用户手动设置的行收起记忆(按状态);容错坏数据 */
function loadRowOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ROW_COLLAPSED_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // 坏数据当无记忆
  }
  return {};
}

export function KanbanColumn({ column, tasks }: KanbanColumnProps) {
  // droppable 挂整行/整列(含列头):收起态(卡片区不渲染)仍可作为拖放目标
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const narrow = useNarrowViewport();
  const [rowOverrides, setRowOverrides] = useState<Record<string, boolean>>(loadRowOverrides);

  // 收起仅紧凑行形态生效:用户手动记忆 ?? 空行默认收起。
  // 行由空变有卡且无手动记忆 → 自动展开(拖卡进来立即可见)
  const collapsed = narrow ? (rowOverrides[column.status] ?? tasks.length === 0) : false;

  const toggleRow = () => {
    setRowOverrides((prev) => {
      const next = { ...prev, [column.status]: !collapsed };
      try {
        localStorage.setItem(ROW_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // 持久化失败不影响本次会话
      }
      return next;
    });
  };

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
    // 宽屏(≥3×260)时列等分铺满;窄屏装不下时 min-w 撑超触发外层 overflow-x-auto 横滚。
    // 紧凑态看板改为"行"形态:全宽行 + 行内卡片横滚(见 ProjectGroup/TaskCard),可收起成一条列头。
    <div
      ref={setNodeRef}
      className={cn(
        'bg-muted/30 flex min-w-[260px] flex-1 flex-col rounded-lg transition-colors @max-[1023px]:w-full @max-[1023px]:min-w-0 @max-[1023px]:flex-none',
        isOver && 'bg-primary/5',
      )}
    >
      <button
        type="button"
        onClick={narrow ? toggleRow : undefined}
        aria-expanded={narrow ? !collapsed : undefined}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left',
          narrow && 'hover:bg-muted/60 cursor-pointer',
        )}
      >
        {narrow && (
          <ChevronDown
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out',
              collapsed && '-rotate-90',
            )}
          />
        )}
        <span className={cn('size-2 rounded-full', column.dotClass)} />
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="text-muted-foreground ml-auto text-xs">{tasks.length}</span>
      </button>
      {!collapsed && (
        <div
          className={cn(
            'flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors',
            // 紧凑:行内横向排布(分组块/卡片),单独左右滚动
            '@max-[1023px]:flex-row @max-[1023px]:items-start @max-[1023px]:overflow-x-auto @max-[1023px]:overflow-y-hidden',
          )}
        >
          {groups.map((group) => (
            <ProjectGroup key={group.key} groupKey={group.key} label={group.label} tasks={group.tasks} />
          ))}
          {tasks.length === 0 && (
            <div className="text-muted-foreground/50 rounded-md border border-dashed py-6 text-center text-xs @max-[1023px]:w-full @max-[1023px]:py-3">
              拖拽任务到此处
            </div>
          )}
        </div>
      )}
    </div>
  );
}
