// frontend/src/components/ui/Drawer.tsx
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number | string;
}

/** 右侧滑出抽屉 */
export function Drawer({ open, onClose, title, children, width = 520 }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-overlay-enter fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="drawer-content-enter flex h-full flex-col shadow-2xl"
        style={{ background: 'var(--bg-lower)', color: 'var(--text-1)', width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <div className="text-base font-semibold">{title}</div>
          <button onClick={onClose} className="rounded p-1 hover:opacity-70" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
