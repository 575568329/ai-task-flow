// frontend/src/components/ui/Toaster.tsx
// 轻量自建 Toast(基于 zustand)。导出 toast 对象 + <Toaster /> 组件。
// 业务层契约:api/http.ts、stores/llmConfigStore.ts 直接 import { toast } 并调
// toast.success/error/info —— 此 API 务必保持稳定,不可改名。
import { create } from 'zustand';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (type: ToastType, message: string) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 3000;

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message) => {
    // 运行时(浏览器)用 Date.now 生成 id,避免使用 index 作 key
    const id = Date.now() + Math.random();
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, TOAST_DURATION_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// 业务层使用的命令式 API
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};

const ICON_MAP: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const ICON_CLASS: Record<ToastType, string> = {
  success: 'text-emerald-500',
  error: 'text-destructive',
  info: 'text-primary',
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON_MAP[t.type];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg transition-all"
          >
            <Icon className={`size-4 shrink-0 ${ICON_CLASS[t.type]}`} />
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="ml-2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
