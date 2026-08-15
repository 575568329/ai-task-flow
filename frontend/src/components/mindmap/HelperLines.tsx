// frontend/src/components/mindmap/HelperLines.tsx
// 对齐辅助线渲染：SVG 覆盖层（pointer-events none），画布坐标 → 屏幕坐标
// 用当前 viewport transform 换算（store 精确订阅，平移缩放时自动重算）。
import { useStore } from '@xyflow/react';
import type { HelperLine } from './useAlignmentSnap';

export function HelperLines({ lines }: { lines: HelperLine[] }) {
  const transform = useStore((s) => s.transform); // [x, y, zoom]
  if (lines.length === 0) return null;
  const [tx, ty, zoom] = transform;

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
      {lines.map((l) => {
        // 画布坐标 → 屏幕坐标：pos * zoom + translate
        const pos = l.position * zoom + (l.type === 'vertical' ? tx : ty);
        return l.type === 'vertical' ? (
          <line key={l.id} x1={pos} x2={pos} y1={0} y2="100%" className="mm-helperline" />
        ) : (
          <line key={l.id} y1={pos} y2={pos} x1={0} x2="100%" className="mm-helperline" />
        );
      })}
    </svg>
  );
}
