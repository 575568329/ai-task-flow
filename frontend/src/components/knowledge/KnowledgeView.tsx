// frontend/src/components/knowledge/KnowledgeView.tsx
// 知识库视图:Resizable 分栏(目录树 | 文档查看器),挂载时拉取 manifest。
// 刷新入口统一收口到 KnowledgeTree 树面板顶部,本视图 header 不再放刷新按钮。
import { useEffect, useState } from 'react';
import { Import } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { fetchManifest, importKnowledge } from '@/api/knowledge';
import { toast } from '@/components/ui/toaster';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgeViewer } from './KnowledgeViewer';

export function KnowledgeView() {
  const manifest = useKnowledgeStore((s) => s.manifest);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const setError = useKnowledgeStore((s) => s.setError);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  // 紧凑视口树面板收窄(与 docs 同策略),保查看器可用宽度
  const narrow = useNarrowViewport();

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

  /** 一次性导入旧知识库(缺省源目录由后端定位仓库内 knowledge-base),成功后刷新 */
  const onImport = async () => {
    setImporting(true);
    try {
      const report = await importKnowledge();
      const suffix = report.errors.length > 0 ? `,失败 ${report.errors.length} 篇` : '';
      toast.success(
        `已复制 ${report.copied} 篇,冲突 ${report.conflicts.length} 篇${suffix}`,
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

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
          variant="outline"
          className="ml-auto"
          disabled={importing}
          onClick={() => void onImport()}
        >
          <Import className="size-3.5" />
          {importing ? '导入中…' : '导入旧知识库'}
        </Button>
      </header>

      <div className="flex-1 overflow-hidden p-2">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={narrow ? '22%' : '28%'} minSize={narrow ? '14%' : '18%'}>
            <KnowledgeTree onRefresh={() => void load()} refreshing={loading} />
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
