// frontend/src/components/knowledge/KnowledgeView.tsx
// 知识库视图:Resizable 分栏(目录树 | 文档查看器),挂载时拉取 manifest。
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { fetchManifest } from '@/api/knowledge';
import { toast } from '@/components/ui/toaster';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgeViewer } from './KnowledgeViewer';

export function KnowledgeView() {
  const manifest = useKnowledgeStore((s) => s.manifest);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const setError = useKnowledgeStore((s) => s.setError);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setManifest(await fetchManifest());
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载知识库失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-semibold">知识库</span>
        {manifest && (
          <span className="text-muted-foreground text-xs">
            {manifest.flatDocs.length} 篇
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          刷新
        </Button>
      </header>

      <div className="flex-1 overflow-hidden p-2">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="28%" minSize="18%">
            <KnowledgeTree />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="72%" minSize="30%">
            <KnowledgeViewer />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
