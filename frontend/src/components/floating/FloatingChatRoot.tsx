// frontend/src/components/floating/FloatingChatRoot.tsx
// 浮窗挂载点:Portal 到 body。去掉旧的 pointer-events-none 全屏遮罩层
// (它把浮窗后代指针事件全吞,是拖/切/历史同时失效的根因——调研结论)。
// 浮窗本体与最小化角标各自 position:fixed,只占自身面积,不挡底层页面交互。
// 无 tab 时整体不渲染。
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import { FloatingChatWindow } from './FloatingChatWindow';
import { useFloatingChatStore } from '@/stores/floatingChatStore';

export function FloatingChatRoot() {
  const taskIds = useFloatingChatStore((s) => s.taskIds);
  const open = useFloatingChatStore((s) => s.open);
  const minimized = useFloatingChatStore((s) => s.minimized);
  const restore = useFloatingChatStore((s) => s.restore);

  // 没有任何 tab → 不渲染(彻底零干扰)
  if (taskIds.length === 0) return null;

  return createPortal(
    <>
      {open && !minimized && <FloatingChatWindow />}
      {minimized && (
        <button
          type="button"
          onClick={restore}
          className="bg-primary text-primary-foreground fixed right-5 bottom-5 z-[1300] inline-flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
          aria-label="恢复对话浮窗"
          title="恢复对话浮窗"
        >
          <MessageSquare className="size-5" />
        </button>
      )}
    </>,
    document.body,
  );
}
