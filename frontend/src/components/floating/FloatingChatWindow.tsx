// frontend/src/components/floating/FloatingChatWindow.tsx
// 项目对话悬浮窗:Pointer Events 自实现拖拽(header)+ 缩放(右下角 handle),不依赖 react-rnd。
// 调研结论(React 19 最佳实践):
//  - onPointerDown 在拖拽 handle,setPointerCapture 保证指针移出元素仍可拖(不丢拖拽);
//  - 实时只更内存 bounds,松手才落盘(避免疯狂写 localStorage);
//  - clamp 到视口,保证标题栏始终可抓回(浏览器 resize 时也拉回)。
// 内容:项目 tab(按 repoPath 分组)+ 左右分栏(左 SessionList 常驻对话列表 + 右 ConversationPanel)。
// 左栏可一键收起,收起状态与 bounds 一起记忆 localStorage(沿用 bounds 同模式,不污染 store)。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X, PanelLeft } from 'lucide-react';
import { ConversationPanel } from './ConversationPanel';
import { SessionList } from './SessionList';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'ai-task-flow:project-chat-bounds:v1';
const SIDEBAR_KEY = 'ai-task-flow:project-chat-sidebar-collapsed:v1';
const MIN_WIDTH = 380;
const MIN_HEIGHT = 420;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 默认尺寸:按视口自适应并居中。SSR 无 window 时给保守值。 */
function defaultBounds(): Bounds {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(760, Math.max(MIN_WIDTH, Math.round(vw * 0.5)));
  const height = Math.min(880, Math.max(MIN_HEIGHT, Math.round(vh * 0.82)));
  return {
    x: Math.max(16, Math.round((vw - width) / 2)),
    y: Math.max(16, Math.round((vh - height) / 2)),
    width,
    height,
  };
}

/** 读取记忆的位置/尺寸(降级默认值,坏数据不阻断) */
function loadBounds(): Bounds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Bounds>;
      if (p && typeof p.width === 'number' && typeof p.height === 'number') {
        return {
          x: typeof p.x === 'number' ? p.x : 0,
          y: typeof p.y === 'number' ? p.y : 0,
          width: Math.max(MIN_WIDTH, p.width),
          height: Math.max(MIN_HEIGHT, p.height),
        };
      }
    }
  } catch (error) {
    console.warn('[FloatingChatWindow] 读取位置缓存失败,用默认值', error);
  }
  return defaultBounds();
}

function saveBounds(b: Bounds): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch (error) {
    console.warn('[FloatingChatWindow] 写入位置缓存失败', error);
  }
}

export function FloatingChatWindow() {
  const projects = useProjectChatStore((s) => s.projects);
  const projectsLoading = useProjectChatStore((s) => s.projectsLoading);
  const activeRepoPath = useProjectChatStore((s) => s.activeRepoPath);
  const selectProject = useProjectChatStore((s) => s.selectProject);
  const closeWindow = useProjectChatStore((s) => s.closeWindow);
  const openSession = useProjectChatStore((s) => s.openSession);
  const startNew = useProjectChatStore((s) => s.startNew);
  // 当前会话 id(左栏高亮用);当前项目的会话列表(左栏数据源)。side 由左栏新建入口传入,不在此读取。
  const currentSessionId = useProjectChatStore((s) =>
    activeRepoPath ? s.conversations[activeRepoPath]?.sessionId : undefined,
  );
  const currentSessions = activeRepoPath
    ? projects.find((p) => p.repoPath === activeRepoPath)?.sessions ?? []
    : [];

  // bounds 用 ref + state:ref 持有最新值(拖拽/缩放 handler 读 ref,不依赖闭包过期),state 触发重渲染
  const boundsRef = useRef<Bounds>(loadBounds());
  // 根元素 ref:拖拽/缩放中直操 DOM style 定位,跳过 React 重渲染(否则整棵窗含消息流每帧重渲 → 闪跳)
  const rootRef = useRef<HTMLDivElement>(null);
  const [bounds, setBoundsState] = useState<Bounds>(boundsRef.current);
  const updateBounds = (next: Bounds) => {
    boundsRef.current = next;
    setBoundsState(next);
  };

  // 左栏收起状态:记忆 localStorage,命令式 collapse/expand 通过 panelRef(react-resizable-panels v4)
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const persistCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      // 忽略:隐私模式/配额,收起状态不落盘不影响功能(下次仍可手动收起)
    }
  };
  const toggleSidebar = () => {
    // 以 panel 真实状态为准(v4 拖拽到阈值会自动收起),避免按钮图标与实际不同步
    const next = !(leftPanelRef.current?.isCollapsed() ?? collapsed);
    if (next) leftPanelRef.current?.collapse();
    else leftPanelRef.current?.expand();
    persistCollapsed(next);
  };
  // 初次挂载:若记忆为收起,命令 Panel 收起(panelRef 首帧可用后)。onCollapse 也会同步 state,幂等。
  useEffect(() => {
    if (collapsed) leftPanelRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拖拽:记录指针起点 + 窗口起点,松手落盘。dragging 用 ref 不触发重渲染。
  const dragging = useRef(false);
  const dragStart = useRef({ px: 0, py: 0, x: 0, y: 0 });
  // 缩放:记录指针起点 + 窗口尺寸。
  const resizing = useRef(false);
  const resizeStart = useRef({ px: 0, py: 0, w: 0, h: 0 });

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // 仅左键
    const b = boundsRef.current;
    dragging.current = true;
    dragStart.current = { px: e.clientX, py: e.clientY, x: b.x, y: b.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    const b = boundsRef.current;
    // clamp:允许部分出视口但留 120px 可抓回;标题栏不被顶出/底出(至少留 48px)
    const x = clamp(dragStart.current.x + dx, -b.width + 120, window.innerWidth - 120);
    const y = clamp(dragStart.current.y + dy, 0, window.innerHeight - 48);
    // 拖拽中用 ref 直操 DOM style,跳过 React 重渲染(避免整棵窗含消息流每帧重渲 → 闪跳)
    boundsRef.current = { ...b, x, y };
    if (rootRef.current) {
      rootRef.current.style.left = `${x}px`;
      rootRef.current.style.top = `${y}px`;
    }
  };
  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // 松手才 setState 同步:让 React state 与 DOM 一致,避免下次重渲染闪回拖拽前位置
    setBoundsState(boundsRef.current);
    saveBounds(boundsRef.current);
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const b = boundsRef.current;
    resizing.current = true;
    resizeStart.current = { px: e.clientX, py: e.clientY, w: b.width, h: b.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    const dw = e.clientX - resizeStart.current.px;
    const dh = e.clientY - resizeStart.current.py;
    const b = boundsRef.current;
    // clamp:不小于最小尺寸,不超出视口右下
    const width = clamp(resizeStart.current.w + dw, MIN_WIDTH, window.innerWidth - b.x);
    const height = clamp(resizeStart.current.h + dh, MIN_HEIGHT, window.innerHeight - b.y);
    // 缩放同样直操 DOM,跳过重渲染
    boundsRef.current = { ...b, width, height };
    if (rootRef.current) {
      rootRef.current.style.width = `${width}px`;
      rootRef.current.style.height = `${height}px`;
    }
  };
  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    resizing.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setBoundsState(boundsRef.current);
    saveBounds(boundsRef.current);
  };

  // 浏览器窗口缩小时,把浮窗 clamp 回视口(避免被抓不回)。只更内存不落盘。
  useEffect(() => {
    const onViewportResize = () => {
      const b = boundsRef.current;
      const x = clamp(b.x, -b.width + 120, window.innerWidth - 120);
      const y = clamp(b.y, 0, window.innerHeight - 48);
      const width = Math.min(b.width, window.innerWidth);
      const height = Math.min(b.height, window.innerHeight);
      updateBounds({ ...b, x, y, width, height });
    };
    window.addEventListener('resize', onViewportResize);
    return () => window.removeEventListener('resize', onViewportResize);
  }, []);

  return (
    <div
      ref={rootRef}
      data-floating-chat="window"
      className="bg-card pointer-events-auto fixed z-[1300] flex flex-col overflow-hidden rounded-lg border shadow-2xl"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      {/* header:拖拽区。内部 tab/按钮 onPointerDown stopPropagation 避免触发拖拽。
          touchAction:none 防触摸拖拽时浏览器滚动;select-none 防拖拽选中文字。 */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 select-none"
        style={{ cursor: 'move', touchAction: 'none' }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        {/* 项目 tab(按 repoPath 分组) */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {projectsLoading && projects.length === 0 && (
            <span className="text-muted-foreground px-2 py-1 text-xs">加载中…</span>
          )}
          {!projectsLoading && projects.length === 0 && (
            <span className="text-muted-foreground px-2 py-1 text-xs">暂无项目(先在某个仓库里建过任务才会有)</span>
          )}
          {projects.map((p) => (
            // div 内嵌 button 合法(button 嵌 button 不合法);tab onPointerDown 阻止拖拽
            <div
              key={p.repoPath}
              role="tab"
              tabIndex={0}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => selectProject(p.repoPath)}
              className={cn(
                'flex max-w-[160px] shrink-0 cursor-pointer items-center rounded px-2 py-1 text-xs transition-colors',
                p.repoPath === activeRepoPath
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-background/50',
              )}
              title={p.repoPath}
            >
              <span className="truncate">{p.projectName || p.repoPath}</span>
            </div>
          ))}
        </div>
        {/* 列表收起按钮(关闭按钮左侧):一键收起/展开左栏对话列表 */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSidebar}
          className={cn(
            'text-muted-foreground hover:text-foreground hover:bg-background/60 inline-flex size-6 shrink-0 items-center justify-center rounded',
            collapsed && 'bg-background/50',
          )}
          aria-label={collapsed ? '展开对话列表' : '收起对话列表'}
          title={collapsed ? '展开对话列表' : '收起对话列表'}
        >
          <PanelLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={closeWindow}
          className="text-muted-foreground hover:text-foreground hover:bg-background/60 shrink-0 rounded p-1"
          aria-label="关闭悬浮窗"
          title="关闭(悬浮球常驻,可再次打开)"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 内容:左右分栏(左 SessionList 常驻对话列表 + 右 ConversationPanel)。左栏可收起。 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel
            defaultSize={22}
            minSize={15}
            collapsible
            collapsedSize={0}
            panelRef={leftPanelRef}
            className="border-r"
          >
            <SessionList
              sessions={currentSessions}
              activeSessionId={currentSessionId}
              loading={projectsLoading}
              onSelect={(id, source) => {
                if (!activeRepoPath) return;
                const s = currentSessions.find((x) => x.sessionId === id);
                void openSession(activeRepoPath, id, source, { title: s?.title, taskTitle: s?.taskTitle });
              }}
              onNew={() => activeRepoPath && startNew(activeRepoPath)}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={78}>
            <ConversationPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
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
