// frontend/src/components/floating/FloatingChatRoot.tsx
// 项目对话浮窗挂载点:Portal 到 body。悬浮球常驻右侧(可拖),悬浮窗 open 时展开。
// 取代旧的任务多 tab 浮窗(floatingChatStore 已删除):新模型按项目分 tab,入口统一走 projectChatStore。
// 去掉旧的 pointer-events-none 全屏遮罩层(它把浮窗后代指针事件全吞,是拖/切/历史同时失效的根因)。
// 浮窗本体与悬浮球各自 position:fixed,只占自身面积,不挡底层页面交互。
import { createPortal } from 'react-dom';
import { FloatingChatBall } from './FloatingChatBall';
import { FloatingChatWindow } from './FloatingChatWindow';
import { useProjectChatStore } from '@/stores/projectChatStore';

export function FloatingChatRoot() {
  const open = useProjectChatStore((s) => s.open);
  return createPortal(
    <>
      {/* 悬浮球:始终常驻(即使窗口关闭),点击展开;可拖动到任意位置 */}
      <FloatingChatBall />
      {open && <FloatingChatWindow />}
    </>,
    document.body,
  );
}
