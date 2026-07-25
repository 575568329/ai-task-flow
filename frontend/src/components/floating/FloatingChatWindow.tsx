// frontend/src/components/floating/FloatingChatWindow.tsx
// 任务对话悬浮窗外壳:Pointer Events 自实现拖拽(header)+ 缩放(右下角 handle),
// 不再依赖 react-rnd。调研结论(React 19 最佳实践):
//  - onPointerDown 在拖拽 handle,setPointerCapture 保证指针移出元素仍可拖(不丢拖拽);
//  - 实时只更内存 setBounds,松手才 persistBounds 落盘(避免疯狂写 localStorage);
//  - clamp 到视口,保证标题栏始终可抓回(浏览器 resize 时也拉回)。
// 外壳只管位置/尺寸/tab/最小化/任务信息条;对话能力全部复用 TaskConversation。
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { X, Minus, MessageSquare, Copy } from 'lucide-react';
import { TaskConversation } from '@/components/board/TaskConversation';
import {
  useFloatingChatStore,
  FLOATING_CHAT_MIN_WIDTH,
  FLOATING_CHAT_MIN_HEIGHT,
} from '@/stores/floatingChatStore';
import { useTaskStore } from '@/stores/taskStore';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

export function FloatingChatWindow() {
  const taskIds = useFloatingChatStore((s) => s.taskIds);
  const activeTaskId = useFloatingChatStore((s) => s.activeTaskId);
  const bounds = useFloatingChatStore((s) => s.bounds);
  const setActive = useFloatingChatStore((s) => s.setActive);
  const closeTask = useFloatingChatStore((s) => s.closeTask);
  const minimize = useFloatingChatStore((s) => s.minimize);
  const setBounds = useFloatingChatStore((s) => s.setBounds);
  const persistBounds = useFloatingChatStore((s) => s.persistBounds);

  const tasks = useTaskStore((s) => s.tasks);
  const task = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? id;

  // 拖拽:记录指针起点 + 窗口起点,松手落盘。dragging 用 ref 不触发重渲染。
  const dragging = useRef(false);
  const dragStart = useRef({ px: 0, py: 0, x: 0, y: 0 });
  // 缩放:记录指针起点 + 窗口尺寸。
  const resizing = useRef(false);
  const resizeStart = useRef({ px: 0, py: 0, w: 0, h: 0 });

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // 仅左键拖拽
    dragging.current = true;
    dragStart.current = { px: e.clientX, py: e.clientY, x: bounds.x, y: bounds.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    // clamp:允许部分出视口但留 120px 可抓回;标题栏不被顶出/底出(至少留 48px)
    const x = clamp(dragStart.current.x + dx, -bounds.width + 120, window.innerWidth - 120);
    const y = clamp(dragStart.current.y + dy, 0, window.innerHeight - 48);
    setBounds({ ...bounds, x, y });
  };
  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistBounds();
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    resizing.current = true;
    resizeStart.current = { px: e.clientX, py: e.clientY, w: bounds.width, h: bounds.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    const dw = e.clientX - resizeStart.current.px;
    const dh = e.clientY - resizeStart.current.py;
    // clamp:不小于最小尺寸,不超出视口右下
    const width = clamp(
      resizeStart.current.w + dw,
      FLOATING_CHAT_MIN_WIDTH,
      window.innerWidth - bounds.x,
    );
    const height = clamp(
      resizeStart.current.h + dh,
      FLOATING_CHAT_MIN_HEIGHT,
      window.innerHeight - bounds.y,
    );
    setBounds({ ...bounds, width, height });
  };
  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    resizing.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistBounds();
  };

  // 浏览器窗口缩小时,把浮窗 clamp 回视口(避免被抓不回)。只更内存不落盘。
  useEffect(() => {
    const onViewportResize = () => {
      const b = useFloatingChatStore.getState().bounds;
      const x = clamp(b.x, -b.width + 120, window.innerWidth - 120);
      const y = clamp(b.y, 0, window.innerHeight - 48);
      const width = Math.min(b.width, window.innerWidth);
      const height = Math.min(b.height, window.innerHeight);
      useFloatingChatStore.getState().setBounds({ ...b, x, y, width, height });
    };
    window.addEventListener('resize', onViewportResize);
    return () => window.removeEventListener('resize', onViewportResize);
  }, []);

  if (!activeTaskId || !task) return null;

  const onCopyRepoPath = async () => {
    if (!task.repoPath) return;
    try {
      await navigator.clipboard.writeText(task.repoPath);
      toast.success('已复制仓库路径');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div
      className="bg-card pointer-events-auto fixed z-[1300] flex flex-col overflow-hidden rounded-lg border shadow-2xl"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      {/* header:拖拽区。内部 tab/按钮 onPointerDown stopPropagation 避免触发拖拽。
          touchAction:none 防触摸拖拽时浏览器滚动;select-none 防拖拽选中文字。 */}
      <div
        className="flex flex-col gap-1 border-b px-2 py-1.5 select-none"
        style={{ cursor: 'move', touchAction: 'none' }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        {/* row1:任务 tabs + 最小化 */}
        <div className="flex items-center gap-1">
          <MessageSquare className="text-muted-foreground size-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {taskIds.map((id) => (
              // div 内嵌 button 合法(button 嵌 button 不合法);tab onPointerDown 阻止拖拽
              <div
                key={id}
                role="tab"
                tabIndex={0}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setActive(id)}
                className={cn(
                  'flex max-w-[140px] shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                  id === activeTaskId
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-background/50',
                )}
                title={titleOf(id)}
              >
                <span className="truncate">{titleOf(id)}</span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTask(id);
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0 rounded px-0.5 hover:bg-background"
                  aria-label="关闭该任务对话"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={minimize}
            className="text-muted-foreground hover:text-foreground hover:bg-background/60 shrink-0 rounded p-1"
            aria-label="最小化"
            title="最小化"
          >
            <Minus className="size-3.5" />
          </button>
        </div>
        {/* row2:当前任务信息条(taskId + 项目名 + repoPath 点击复制)。
            用户反馈「看不到当前任务 ID / 项目地址」,这里统一补齐。 */}
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 font-mono text-[10px]">
            {task.id}
          </Badge>
          {task.projectName && (
            <span className="text-muted-foreground shrink-0 truncate">{task.projectName}</span>
          )}
          {task.repoPath && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onCopyRepoPath}
              className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-0.5 transition-colors"
              title={`点击复制:${task.repoPath}`}
            >
              <span className="truncate font-mono text-[10px]">{task.repoPath}</span>
              <Copy className="size-3 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* 内容:当前 tab 的任务对话(复用 TaskConversation,流式/历史/重命名/sessionId 全继承) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TaskConversation taskId={activeTaskId} />
      </div>

      {/* 右下角缩放 handle:clipPath 裁成三角形,占位小但可抓 */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        className="hover:bg-border absolute right-0 bottom-0 size-4 cursor-nwse-resize"
        style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', touchAction: 'none' }}
        aria-label="缩放"
      />
    </div>
  );
}
