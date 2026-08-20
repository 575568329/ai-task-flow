// frontend/src/components/floating/FloatingDock.tsx
// 右下角悬浮坞:对话球 + 打开终端,上下对齐、固定位置(不可拖)。
// 任一页面都可快速打开对话/终端,不必切回看板页。
// data-floating-chat="dock":TaskDrawer 据此判断点的是悬浮元素、不关抽屉。
// 任务抽屉打开期间整体淡出:紧凑态 95vw 全宽抽屉下悬浮球会压住抽屉 footer
// (抽屉自身已提供"对话/打开终端"入口);关闭抽屉后悬浮坞淡入恢复。
import { useState } from 'react';
import { MessageSquare, Terminal } from 'lucide-react';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { useUIStore } from '@/stores/uiStore';
import { OpenClaudeDialog } from '@/components/board/OpenClaudeDialog';
import { cn } from '@/lib/utils';

export function FloatingDock() {
  const openWindow = useProjectChatStore((s) => s.openWindow);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const creatingTask = useUIStore((s) => s.creatingTask);
  const drawerOpen = selectedTaskId !== null || creatingTask;

  return (
    <>
      <div
        data-floating-chat="dock"
        className={cn(
          'fixed right-6 bottom-6 z-[1200] flex flex-col items-center gap-3 transition-opacity duration-200',
          drawerOpen && 'pointer-events-none opacity-0',
        )}
      >
        {/* 打开终端(上):新建 / 恢复 Claude 会话 */}
        <button
          type="button"
          onClick={() => setTerminalOpen(true)}
          className="bg-background text-foreground border-border hover:bg-accent inline-flex size-12 items-center justify-center rounded-full border shadow-md transition-transform hover:scale-105"
          aria-label="打开终端"
          title="打开终端 (新建 / 恢复 Claude 会话)"
        >
          <Terminal className="size-5" />
        </button>
        {/* 对话悬浮球(下):点击展开悬浮窗 */}
        <button
          type="button"
          onClick={openWindow}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
          aria-label="打开对话悬浮窗"
          title="点击打开对话"
        >
          <MessageSquare className="size-5" />
        </button>
      </div>
      <OpenClaudeDialog
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        env="pwsh"
        allowPickRepo
      />
    </>
  );
}
