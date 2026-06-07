// frontend/src/components/ui/Switch.tsx
import { cn } from '@/lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 尺寸,默认 sm */
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
  /** 阻止事件冒泡(用于卡片/可拖拽容器内) */
  stopPropagation?: boolean;
}

/** 滑块开关:用于表示"已完成"这类二元状态,比复选框语义更明确 */
export function Switch({ checked, onChange, size = 'sm', title, className, stopPropagation }: SwitchProps) {
  const dims = size === 'sm'
    ? { w: 28, h: 16, knob: 12 }
    : { w: 36, h: 20, knob: 16 };
  const offset = checked ? dims.w - dims.knob - 2 : 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('relative inline-flex shrink-0 items-center rounded-full transition-colors', className)}
      style={{
        width: dims.w,
        height: dims.h,
        backgroundColor: checked ? 'var(--success-6)' : 'var(--surface-3, #d0d0d0)',
        cursor: 'pointer',
      }}
    >
      <span
        className="absolute rounded-full bg-white shadow-sm transition-all"
        style={{ width: dims.knob, height: dims.knob, left: offset }}
      />
    </button>
  );
}
