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
import { TaskCard, TaskCardBody } from './TaskCard';
import { Collapse } from '@/components/ui/collapse';
import { useBoardGroupingStore } from '@/stores/boardGroupingStore';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import { cn } from '@/lib/utils';

interface ProjectGroupProps {
  /** 分组标识:projectName 或 UNGROUPED_KEY。折叠记忆以此为准。 */
  groupKey: string;
  label: string;
  tasks: TaskDTO[];
}

export function ProjectGroup({ groupKey, label, tasks }: ProjectGroupProps) {
  const collapsed = useBoardGroupingStore((s) => s.collapsedGroups[groupKey] === true);
  const toggleGroup = useBoardGroupingStore((s) => s.toggleGroup);
  // 紧凑行形态卡片横排 → 折叠用横向收拢(向左收,右侧分组滑来补位);宽屏列形态纵向塌缩
  const narrow = useNarrowViewport();

  // 组内卡片列表(展开态渲染;两种形态共用)
  const groupCards = (
    <div className="flex flex-col gap-2 pt-1 @max-[1023px]:flex-row @max-[1023px]:items-stretch">
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
  );

  return (
    // 紧凑(看板行形态):分组块作为整体参与行内横排(shrink-0),组内卡片也横向排
    <div className="flex flex-col gap-1 @max-[1023px]:shrink-0">
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

      {/* 紧凑收起态:卡片叠堆(业界 stacked cards 模式)——顶层首张真实卡 +
          底下两层错位露边,一眼看出"这里收了一摞任务";点击整堆展开。
          宽屏列形态收起无卡堆(纵向组头一条即可)。 */}
      {narrow && collapsed && tasks.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(groupKey)}
          className="group/stack relative mr-2 mb-2 h-[128px] w-64 shrink-0 cursor-pointer rounded-md text-left transition-transform hover:-translate-y-0.5"
          title={`展开「${label}」(${tasks.length} 张)`}
          aria-label={`展开分组 ${label},${tasks.length} 张任务`}
        >
          {/* 底层两张错位"卡背":只露边,营造一沓的厚度 */}
          <div className="border-border/60 bg-card/60 absolute inset-0 translate-x-2 translate-y-2 rounded-md border" />
          <div className="border-border bg-card/80 absolute inset-0 translate-x-1 translate-y-1 rounded-md border" />
          {/* 顶层:首张真实卡内容。p-2.5 与 TaskCard 外壳一致,视觉与展开态卡片相同;
              pointer-events-none:点击是展开分组,不吃卡片的选/拽 */}
          <div className="border-border bg-card pointer-events-none absolute inset-0 overflow-hidden rounded-md border p-2.5 shadow-sm">
            <TaskCardBody task={tasks[0]} />
          </div>
        </button>
      )}

      {/* 紧凑:收起即卸载——grid 0fr 横向塌缩在 flex 布局里会被 stretch 撑住,
          收起态残留占位把行内布局顶乱(实测 264×110 幽灵块);
          展开动画交给卡片 AnimatePresence 淡入。
          宽屏:保持原纵向 Collapse(0fr 高度塌缩在纵列表中工作正常) */}
      {narrow ? (
        !collapsed && (
          <Collapse open direction="horizontal">
            {groupCards}
          </Collapse>
        )
      ) : (
        <Collapse open={!collapsed} direction="vertical">
          {groupCards}
        </Collapse>
      )}
    </div>
  );
}
