// frontend/src/App.tsx
// 应用骨架:启动副作用(SSE 实时事件 / 初始拉取 / 健康检查)+ 视图切换(keep-alive)+ 主题。
// 业务层(api/stores)零改动,这里只负责编排。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { SidebarNav, type ViewKey } from '@/components/SidebarNav';
import { BoardView } from '@/components/views/BoardView';
import { ChatView } from '@/components/views/ChatView';
import { DocsView } from '@/components/views/DocsView';
import { KnowledgeView } from '@/components/views/KnowledgeView';
import { StorageManager } from '@/components/StorageManager';
import { Toaster } from '@/components/ui/Toaster';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { sseClient } from '@/api/sse';
import { fetchHealth, systemApi } from '@/api/task';

const VIEWS: Record<ViewKey, ComponentType> = {
  board: BoardView,
  chat: ChatView,
  docs: DocsView,
  knowledge: KnowledgeView,
};

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('board');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 启动副作用:SSE 实时事件 → taskStore、初始拉取任务、健康检查定 localAccess、存储占用定 storageWarn 红点。
  useEffect(() => {
    const { applySSEEvent, fetchAll } = useTaskStore.getState();
    const { setLocalAccess, setStorageWarn } = useUIStore.getState();

    void fetchAll();
    sseClient.connect();
    const unsubscribe = sseClient.on(applySSEEvent);
    void fetchHealth().then((h) => setLocalAccess(h.localAccess));
    // 启动拉一次占用,定侧边栏红点(silent:后端未就绪不弹错)
    void systemApi.getStorage().then((s) => setStorageWarn(s.warning));

    return () => {
      unsubscribe();
      sseClient.close();
    };
  }, []);

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <SidebarNav
        activeView={activeView}
        onViewChange={setActiveView}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="flex-1 overflow-hidden">
        {/* keep-alive:全部挂载,用 hidden 切换,保留各视图内部状态(聊天滚动/分栏位置等) */}
        {(Object.keys(VIEWS) as ViewKey[]).map((key) => {
          const View = VIEWS[key];
          return (
            <div key={key} className="h-full" hidden={key !== activeView}>
              <View />
            </div>
          );
        })}
      </main>
      <StorageManager open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster />
    </div>
  );
}

export default App;
