// frontend/src/hooks/useNarrowViewport.ts
// 窄视口判定(<1024px):给 JS 层面需要的断点逻辑用(ResizablePanel 的 props、
// 折叠初始值等)。CSS 层面的降级用 main 上的 @container 容器查询,不走此 hook;
// portal 到 body 的弹层用 Tailwind 视口断点(max-lg:),也不走此 hook。
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 1023px)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
