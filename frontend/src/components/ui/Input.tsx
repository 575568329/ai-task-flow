// frontend/src/components/ui/Input.tsx
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-[--primary]';

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-lower)',
  borderColor: 'var(--border-primary)',
  color: 'var(--text-1)',
};

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, style, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(fieldBase, className)}
        style={{ ...fieldStyle, ...style }}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, style, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(fieldBase, 'resize-y', className)}
        style={{ ...fieldStyle, ...style }}
        {...props}
      />
    );
  }
);
