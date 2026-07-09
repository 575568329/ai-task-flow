// frontend/src/components/ui/image-preview.tsx
// 图片预览蒙版:点击图片触发(全局 previewStore)。
// 支持:滚轮缩放、拖拽平移、双击复位、工具栏放大/缩小/复位/关闭、ESC/点遮罩关闭。
import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { usePreviewStore } from '@/stores/previewStore';
import { cn } from '@/lib/utils';

const MIN_SCALE = 0.3;
const MAX_SCALE = 5;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function ImagePreviewOverlay() {
  const src = usePreviewStore((s) => s.src);
  const close = usePreviewStore((s) => s.close);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 打开新图时复位变换
  useEffect(() => {
    if (src) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    }
  }, [src]);

  // ESC 关闭 + 非被动滚轮缩放(React onWheel 默认 passive,preventDefault 无效,需原生监听)
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => clamp(s - e.deltaY * 0.0015, MIN_SCALE, MAX_SCALE));
    };
    window.addEventListener('keydown', onKey);
    wrapRef.current?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      wrapRef.current?.removeEventListener('wheel', onWheel);
    };
  }, [src, close]);

  if (!src) return null;

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };
  const zoom = (delta: number) => setScale((s) => clamp(s + delta, MIN_SCALE, MAX_SCALE));

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={close}
    >
      {/* 工具栏 */}
      <div
        className="absolute right-3 top-3 z-10 flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="text-white/80 hover:bg-white/20 hover:text-white rounded p-1.5"
          onClick={() => zoom(-0.2)}
          aria-label="缩小"
        >
          <ZoomOut className="size-4" />
        </button>
        <span className="text-white/70 min-w-[3rem] text-center text-xs">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="text-white/80 hover:bg-white/20 hover:text-white rounded p-1.5"
          onClick={() => zoom(0.2)}
          aria-label="放大"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          className="text-white/80 hover:bg-white/20 hover:text-white rounded p-1.5"
          onClick={reset}
          aria-label="复位"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          className="text-white/80 hover:bg-white/20 hover:text-white rounded p-1.5"
          onClick={close}
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={wrapRef}
        className="flex select-none items-center justify-center"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: dragging ? 'grabbing' : 'grab',
          transition: dragging ? 'none' : 'transform 0.1s',
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={reset}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <img
          src={src}
          alt="预览"
          className={cn('max-h-[90vh] max-w-[90vw] object-contain')}
          draggable={false}
        />
      </div>

      <div className="text-white/50 absolute bottom-3 left-1/2 -translate-x-1/2 text-xs">
        滚轮缩放 · 拖拽移动 · 双击复位 · ESC 关闭
      </div>
    </div>
  );
}
