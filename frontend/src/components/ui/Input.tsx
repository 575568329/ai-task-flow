// frontend/src/components/ui/Input.tsx
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-[--primary]';

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
};

export function Input({ className, style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={cn(fieldBase, className)} style={{ ...fieldStyle, ...style }} {...props} />
  );
}

export function Textarea({
  className,
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldBase, 'resize-y', className)}
      style={{ ...fieldStyle, ...style }}
      {...props}
    />
  );
}
