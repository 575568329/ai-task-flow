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
import { useUIStore } from '@/stores/uiStore';
import { fetchManifest, importKnowledge } from '@/api/knowledge';
import { worklogApi } from '@/api/worklog';
import { buildWorklogIndex } from '@/lib/knowledgeViews';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgeViewer } from './KnowledgeViewer';

export function KnowledgeView() {
  const manifest = useKnowledgeStore((s) => s.manifest);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const setError = useKnowledgeStore((s) => s.setError);
  const setWorklogIndex = useKnowledgeStore((s) => s.setWorklogIndex);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  /** 本次会话是否已导入过(再次导入会产生 -imported 副本,需二次确认) */
  const [importedOnce, setImportedOnce] = useState(false);
  // 导入端点仅回环可达,LAN 访问下隐藏入口
  const localAccess = useUIStore((s) => s.localAccess);
  const { confirm } = useConfirm();
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

  // worklog 索引仅用于把版本/需求/项目 id 映射成名称;失败静默,退回展示 id
  useEffect(() => {
    worklogApi
      .getTree()
      .then((tree) => setWorklogIndex(buildWorklogIndex(tree)))
      .catch(() => {
        /* 索引是展示增强,失败不影响知识库主流程 */
      });
  }, [setWorklogIndex]);

  /** 导入旧知识库(源目录固定由后端解析仓库内 knowledge-base),成功后刷新 */
  const onImport = async () => {
    // 重复导入不覆盖,但会不断产生 -imported 副本,先确认
    if (
      importedOnce &&
      !(await confirm({
        title: '再次导入',
        description:
          '重复导入不会覆盖已有文件,同名文件会生成 -imported 副本,可能产生大量重复文档。继续吗?',
        confirmText: '继续导入',
      }))
    ) {
      return;
    }
    setImporting(true);
    try {
      const report = await importKnowledge();
      const suffix = report.errors.length > 0 ? `,失败 ${report.errors.length} 篇` : '';
      const message = `已复制 ${report.copied} 篇,冲突 ${report.conflicts.length} 篇${suffix}`;
      // 部分文件失败属可继续的告警,不应报成功
      if (report.errors.length > 0) toast.warning(message);
      else toast.success(message);
      setImportedOnce(true);
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
        {localAccess && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={importing}
            onClick={() => void onImport()}
          >
            <Import className="size-3.5" />
            {importing ? '导入中…' : importedOnce ? '再次导入(会产生副本)' : '导入旧知识库'}
          </Button>
        )}
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
