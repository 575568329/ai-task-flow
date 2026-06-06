// frontend/src/components/ui/Button.tsx
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3.5 py-2 text-sm',
};

const variants: Record<Variant, string> = {
  primary: 'text-white hover:opacity-90',
  secondary: 'border hover:opacity-80',
  ghost: 'hover:opacity-70',
  danger: 'text-white hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  style,
  ...props
}: ButtonProps) {
  const variantStyle: React.CSSProperties =
    variant === 'primary'
      ? { background: 'var(--brand-primary)' }
      : variant === 'danger'
        ? { background: 'var(--danger-primary)' }
        : variant === 'secondary'
          ? { borderColor: 'var(--border-primary)', color: 'var(--text-1)', background: 'var(--bg-lower)' }
          : { color: 'var(--text-1)' };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      style={{ ...variantStyle, ...style }}
      {...props}
    />
  );
}
