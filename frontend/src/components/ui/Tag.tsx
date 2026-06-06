// frontend/src/components/ui/Tag.tsx
import type { ReactNode, CSSProperties } from 'react';
import { cn } from '@/lib/cn';

interface TagProps {
  children: ReactNode;
  color?: string; // CSS 颜色或 var(--xxx)
  filled?: boolean;
  className?: string;
}

/** 小标签:filled 实心(白字),否则描边 */
export function Tag({ children, color = 'var(--text-muted)', filled = false, className }: TagProps) {
  const style: CSSProperties = filled
    ? { background: color, color: '#fff' }
    : { borderColor: color, color, borderWidth: 1, borderStyle: 'solid' };

  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={style}
    >
      {children}
    </span>
  );
}

/** 数字徽标 */
export function Badge({ count, color = 'var(--text-muted)' }: { count: number; color?: string }) {
  return (
    <span
      className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold text-white"
      style={{ background: color }}
    >
      {count}
    </span>
  );
}
