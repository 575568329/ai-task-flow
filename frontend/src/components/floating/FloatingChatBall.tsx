// frontend/src/components/floating/FloatingChatBall.tsx
// 项目对话悬浮球:常驻右侧,可拖到任意位置(位置记忆 localStorage),点击展开悬浮窗。
// Pointer Events + setPointerCapture(React 19 最佳实践,替代 react-rnd):
//  - 拖拽中指针移出球体仍跟随(setPointerCapture 保证不丢拖拽);
//  - 位移 < 阈值视为点击(展开窗),否则为拖拽(不展开),避免拖完误触开窗;
//  - 拖完落盘位置,下次启动恢复。touchAction:none 防触摸拖拽时浏览器滚动。
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import { useProjectChatStore } from '@/stores/projectChatStore';

const STORAGE_KEY = 'ai-task-flow:chat-ball-pos:v1';
const DRAG_THRESHOLD = 5; // 指针位移 < 5px 视为点击
const BALL_SIZE = 48;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

function defaultPos() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { x: vw - BALL_SIZE - 24, y: vh - BALL_SIZE - 96 };
}

function loadPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
    }
  } catch (error) {
    // 位置记忆是增强非关键,坏数据降级默认值,留痕便于排查(CLAUDE.md 禁止空 catch)
    console.warn('[FloatingChatBall] 读取位置缓存失败', error);
  }
  return defaultPos();
}

function savePos(pos: { x: number; y: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch (error) {
    console.warn('[FloatingChatBall] 写入位置缓存失败', error);
  }
}

export function FloatingChatBall() {
  const openWindow = useProjectChatStore((s) => s.openWindow);
  // posRef 持有最新位置(拖拽实时更新,不依赖 state 闭包);state 仅触发重渲染定位
  const posRef = useRef(loadPos());
  const [pos, setPos] = useState(posRef.current);
  const dragging = useRef(false);
  const moved = useRef(false);
  const start = useRef({ px: 0, py: 0, x: 0, y: 0 });

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return; // 仅左键
    dragging.current = true;
    moved.current = false;
    start.current = { px: e.clientX, py: e.clientY, x: posRef.current.x, y: posRef.current.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - start.current.px;
    const dy = e.clientY - start.current.py;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved.current = true;
    const x = clamp(start.current.x + dx, 0, window.innerWidth - BALL_SIZE);
    const y = clamp(start.current.y + dy, 0, window.innerHeight - BALL_SIZE);
    posRef.current = { x, y };
    setPos({ x, y });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    savePos(posRef.current);
    // 未发生有效位移 = 点击 → 展开悬浮窗;拖拽则不展开
    if (!moved.current) openWindow();
  };

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="bg-primary text-primary-foreground hover:bg-primary/90 fixed z-[1200] inline-flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
      aria-label="打开对话悬浮窗(可拖动)"
      title="点击打开对话 · 可拖动到任意位置"
    >
      <MessageSquare className="size-5" />
    </button>
  );
}
