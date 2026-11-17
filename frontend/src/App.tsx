// frontend/src/App.tsx
// 应用骨架:启动副作用(健康检查 / 存储红点)+ 视图切换(keep-alive)+ 主题。
// worklog 转型 Step6:工作记录页为默认落地视图。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import { SidebarNav, type ViewKey } from '@/components/SidebarNav';
import { WorklogView } from '@/components/views/WorklogView';
import { KnowledgeView } from '@/components/views/KnowledgeView';
import { VocabView } from '@/components/views/VocabView';
import { MindmapView } from '@/components/views/MindmapView';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Toaster } from '@/components/ui/toaster';
import { ImagePreviewOverlay } from '@/components/ui/image-preview';
import { useUIStore } from '@/stores/uiStore';
import { fetchHealth, systemApi } from '@/api/system';

const VIEWS: Record<ViewKey, ComponentType> = {
  worklog: WorklogView,
  knowledge: KnowledgeView,
  vocab: VocabView,
  mindmap: MindmapView,
};

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('worklog');
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const settingsTab = useUIStore((s) => s.settingsTab);
  // 视图切换淡入:keep-alive 架构下视图不卸载(保留分栏等状态),
  // 故只对主内容区整体做 opacity 淡入,而非逐视图进退场(那会丢失各视图状态)。
  const viewControls = useAnimationControls();

  // 启动副作用:健康检查定 localAccess、存储占用定侧边栏红点。
  useEffect(() => {
    const { setLocalAccess, setStorageWarn } = useUIStore.getState();
    void fetchHealth().then((h) => setLocalAccess(h.localAccess));
    // 启动拉一次占用,定侧边栏红点(silent:后端未就绪不弹错)
    void systemApi.getStorage().then((s) => setStorageWarn(s.warning));
  }, []);

  // activeView 变化 → 主内容区快速淡入(不卸载视图,状态得以保留)
  useEffect(() => {
    void viewControls.start({ opacity: [0, 1], transition: { duration: 0.15, ease: 'easeOut' } });
  }, [activeView, viewControls]);

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <SidebarNav
        activeView={activeView}
        onViewChange={setActiveView}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {/* @container:内部视图按"实际内容宽"做紧凑/宽敞降级(容器查询),
          独立窗口拖窄、uTools 主窗 802 都按 main 实宽触发,视口断点会误判 */}
      <main className="@container flex-1 overflow-hidden">
        <motion.div animate={viewControls} className="h-full">
          {/* keep-alive:全部挂载,用 hidden 切换,保留各视图内部状态 */}
          {(Object.keys(VIEWS) as ViewKey[]).map((key) => {
            const View = VIEWS[key];
            return (
              <div key={key} className="h-full" hidden={key !== activeView}>
                <View />
              </div>
            );
          })}
        </motion.div>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab ?? undefined} />
      <Toaster />
      <ImagePreviewOverlay />
    </div>
  );
}

export default App;
