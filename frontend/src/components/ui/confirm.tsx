// frontend/src/components/ui/confirm.tsx
// 统一的确认/输入弹窗:用官方 AlertDialog 渲染,对外暴露 Promise 化的
// confirm() / prompt(),调用处用 await,保持与原 window.confirm 几乎一致的同步式写法。
//
// 用法:
//   const { confirm, prompt } = useConfirm();
//   if (!(await confirm({ description: '确认删除?', variant: 'destructive' }))) return;
//   const text = await prompt({ description: '请输入原因', placeholder: '原因…' });
//   if (text === null) return; // null = 用户取消
import {
  createContext,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  /** 标题(可选,不传则只显示描述) */
  title?: string;
  /** 正文,支持多行(传带 \n 的字符串即可);也支持任意 ReactNode */
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** destructive 会把确认按钮染红,用于删除等不可逆操作 */
  variant?: 'default' | 'destructive';
}

export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
}

export interface ConfirmApi {
  /** true = 确认,false = 取消/遮罩/ESC */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** 输入文本;null = 取消/遮罩/ESC(空输入返回空串 '') */
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

/** 必须在 <ConfirmProvider> 包裹的组件树内调用 */
export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用');
  return ctx;
}

interface DialogState {
  open: boolean;
  mode: 'confirm' | 'prompt';
  opts: ConfirmOptions | PromptOptions;
  input: string;
}

const INITIAL_STATE: DialogState = {
  open: false,
  mode: 'confirm',
  opts: { description: '' },
  input: '',
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  // resolve 用 ref 存:setState 是异步的,放 state 里会在"按钮关闭"+"遮罩关闭"竞态时丢失。
  // onOpenChange 据此区分:resolveRef 已清 = 按钮自己处理的关闭,跳过;还在 = 遮罩/ESC,兜底 settle。
  const resolveRef = useRef<((value: boolean | string | null) => void) | null>(null);
  const [state, setState] = useState<DialogState>(INITIAL_STATE);

  const api: ConfirmApi = {
    confirm: (opts) =>
      new Promise<boolean>((resolve) => {
        // resolve 实际只收 boolean,但 mode↔值类型 的对应 TS 无法静态表达,统一断言为 Resolver
        resolveRef.current = resolve as (value: boolean | string | null) => void;
        setState({ open: true, mode: 'confirm', opts, input: '' });
      }),
    prompt: (opts) =>
      new Promise<string | null>((resolve) => {
        resolveRef.current = resolve as (value: boolean | string | null) => void;
        setState({ open: true, mode: 'prompt', opts, input: opts.defaultValue ?? '' });
      }),
  };

  /** 一次性兑现 Promise 并关闭;清空 resolveRef 标记"已处理" */
  const settle = (value: boolean | string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  };

  const { mode, opts, input } = state;
  const isPrompt = mode === 'prompt';
  const isDestructive = opts.variant === 'destructive';

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      settle(input);
    }
  };

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(o) => {
          // 关闭请求来自遮罩/ESC(按钮已自行 settle 并清空 resolveRef);此时兜底拒绝
          if (!o && resolveRef.current) {
            settle(isPrompt ? null : false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {opts.title && <AlertDialogTitle>{opts.title}</AlertDialogTitle>}
            <AlertDialogDescription asChild>
              {/* span 而非 div:Radix Description 默认渲染 p,p 内不能嵌 block;whitespace-pre-wrap 保留 \n */}
              <span className="text-muted-foreground whitespace-pre-wrap text-sm">
                {opts.description}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isPrompt && (
            <Input
              value={input}
              placeholder={(opts as PromptOptions).placeholder}
              autoFocus
              onChange={(e) => setState((s) => ({ ...s, input: e.target.value }))}
              onKeyDown={onInputKeyDown}
            />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(isPrompt ? null : false)}>
              {opts.cancelText ?? '取消'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(isPrompt ? input : true)}
              // destructive 用 !important 覆盖 AlertDialogAction 默认的 primary 底色
              className={cn(
                isDestructive &&
                  'bg-destructive! text-white hover:bg-destructive/90!',
              )}
            >
              {opts.confirmText ?? '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
