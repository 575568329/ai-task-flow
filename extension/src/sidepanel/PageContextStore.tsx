// extension/src/sidepanel/PageContextStore.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PageContext } from '../types/pageContext.js';

interface PageContextValue {
  pageContext: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
  error: string | null;
}

const Ctx = createContext<PageContextValue | null>(null);

interface CaptureMessage {
  type: 'CAPTURE_RESULT' | 'CAPTURE_ERROR';
  payload?: PageContext;
  message?: string;
}

/** 所有视图共享的页面上下文（剪藏建任务 / 未来对话喂 AI 共用同一份抓取结果） */
export function PageContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = (message: CaptureMessage) => {
      if (message.type === 'CAPTURE_RESULT' && message.payload) {
        setPageContext(message.payload);
        setError(null);
      } else if (message.type === 'CAPTURE_ERROR') {
        setError(message.message ?? '抓取失败');
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return <Ctx.Provider value={{ pageContext, setPageContext, error }}>{children}</Ctx.Provider>;
}

export function usePageContext(): PageContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePageContext 必须在 PageContextProvider 内使用');
  return value;
}
