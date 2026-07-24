// frontend/src/components/board/ProjectGroup.tsx
// 列内项目分组:可折叠组头(箭头 + 项目名 + 计数),展开/收起带高度过渡动画。
// 折叠态取自 uiStore.collapsedGroups(按 projectName 全局记忆),点击组头 toggle。
//
// 【全站动画规则·本组件】
// 1. 折叠高度:复用 <Collapse>(grid-template-rows 0fr↔1fr,200ms ease-out)。
// 2. 箭头:单 ChevronDown + rotate(-90 收起),transition-transform,不切两个 icon。
// 3. 任务卡新增:AnimatePresence + motion.div 只淡入(opacity),不设 exit ——
//    TaskCard 是 dnd-kit draggable,退场 transform 会与拖拽冲突,故只做入场。
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import { TaskCard } from './TaskCard';
import { Collapse } from '@/components/ui/collapse';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface ProjectGroupProps {
  /** 分组标识:projectName 或 UNGROUPED_KEY。折叠记忆以此为准。 */
  groupKey: string;
  label: string;
  tasks: TaskDTO[];
}

export function ProjectGroup({ groupKey, label, tasks }: ProjectGroupProps) {
  const collapsed = useUIStore((s) => s.collapsedGroups[groupKey] === true);
  const toggleGroup = useUIStore((s) => s.toggleGroup);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => toggleGroup(groupKey)}
        className="hover:bg-muted/60 flex items-center gap-1 rounded px-1 py-0.5 text-left"
        title={collapsed ? '展开此项目' : '收起此项目'}
        aria-expanded={!collapsed}
      >
        <ChevronDown
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-out',
            collapsed && '-rotate-90',
          )}
        />
        <span className="text-muted-foreground truncate text-xs font-semibold">{label}</span>
        <span className="text-muted-foreground/70 text-[10px]">{tasks.length}</span>
      </button>

      <Collapse open={!collapsed}>
        <div className="flex flex-col gap-2 pt-1">
          {/* initial={false}:首屏不播,避免几十张卡同时淡入闪烁;仅真正新增的卡才淡入 */}
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <TaskCard task={task} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </Collapse>
    </div>
  );
}
