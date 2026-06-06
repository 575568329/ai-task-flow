// frontend/src/components/ui/Toaster.tsx
import { useEffect } from 'react';
import { create } from 'zustand';
import { CheckCircle, XCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (type: ToastType, message: string) => void;
  remove: (id: number) => void;
}

let seq = 0;
const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 命令式 API:toast.success('xxx') */
export const toast = {
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
  info: (m: string) => useToastStore.getState().push('info', m),
};

const colorMap: Record<ToastType, string> = {
  success: 'var(--status-done)',
  error: 'var(--status-blocked)',
  info: 'var(--status-todo)',
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    // 占位:动画可后续加
  }, []);
  const Icon = t.type === 'success' ? CheckCircle : t.type === 'error' ? XCircle : Info;
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-lg"
      style={{ background: 'var(--surface)', color: 'var(--text)', borderLeft: `3px solid ${colorMap[t.type]}` }}
      onClick={onClose}
    >
      <Icon size={16} style={{ color: colorMap[t.type] }} />
      {t.message}
    </div>
  );
}
