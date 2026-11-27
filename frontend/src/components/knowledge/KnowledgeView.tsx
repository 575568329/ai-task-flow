// frontend/src/components/knowledge/KnowledgeView.tsx
// 知识库视图:Resizable 分栏(目录树 | 文档查看器),挂载时拉取 manifest。
// 刷新入口统一收口到 KnowledgeTree 树面板顶部,本视图 header 只放导入/导出。
import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Download, FileUp, FolderUp, Import } from 'lucide-react';
import type {
  KnowledgeImportFile,
  KnowledgeImportReport,
} from '@ai-task-flow/shared';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { useUIStore } from '@/stores/uiStore';
import {
  exportKnowledge,
  fetchManifest,
  importKnowledgeFiles,
} from '@/api/knowledge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { worklogApi } from '@/api/worklog';
import { buildWorklogIndex } from '@/lib/knowledgeViews';
import { toast } from '@/components/ui/toaster';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgeViewer } from './KnowledgeViewer';

/** 允许导入的文本后缀(与后端接收口径一致) */
const TEXT_FILE_RE = /\.(md|markdown|txt|json|csv|html|htm|yml|yaml)$/i;
/** 二进制附件:导出会带上它们,导入也要能原样放回来 */
const BINARY_FILE_RE = /\.(pdf|png|jpg|jpeg|gif|webp|svg|docx)$/i;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** 浏览器 File → base64(不含 data: 前缀),交给后端按字节写入 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** 导入报告 → 一句中文摘要:主句只报结果,冲突/跳过按需追加 */
function formatReport(report: KnowledgeImportReport): string {
  const parts = [`新增 ${report.copied} 篇`];
  if (report.conflicts.length > 0) parts.push(`重名另存 ${report.conflicts.length} 篇`);
  if (report.skipped > 0) parts.push(`已存在 ${report.skipped} 篇`);
  if (report.errors.length > 0) parts.push(`失败 ${report.errors.length} 篇`);
  return parts.join(',');
}

export function KnowledgeView() {
  const manifest = useKnowledgeStore((s) => s.manifest);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const setError = useKnowledgeStore((s) => s.setError);
  const setWorklogIndex = useKnowledgeStore((s) => s.setWorklogIndex);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // 导入/导出端点仅回环可达,LAN 访问下隐藏入口
  const localAccess = useUIStore((s) => s.localAccess);
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

  // worklog 索引仅用于把版本/项目 id 映射成名称;失败静默,退回展示 id
  useEffect(() => {
    worklogApi
      .getTree()
      .then((tree) => setWorklogIndex(buildWorklogIndex(tree)))
      .catch(() => {
        /* 索引是展示增强,失败不影响知识库主流程 */
      });
  }, [setWorklogIndex]);

  /** 导出整个知识库为 zip:解压后可用「选择文件夹」原样导回 */
  const onExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await exportKnowledge();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      // 立刻 revoke 会让部分浏览器拿不到数据,延后一拍
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`已导出 ${filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  /** 读取用户选择的文件/文件夹并提交;文本走 utf8、二进制走 base64,单文件 5MB */
  const importPickedFiles = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const accepted = picked.filter(
      (file) =>
        (TEXT_FILE_RE.test(file.name) || BINARY_FILE_RE.test(file.name)) &&
        file.size <= MAX_IMPORT_FILE_BYTES,
    );
    const skippedCount = picked.length - accepted.length;
    if (accepted.length === 0) {
      toast.error('没有可导入的文件(支持 Markdown/文本/PDF/图片/Word)');
      return;
    }
    if (skippedCount > 0) {
      toast.warning(`已跳过 ${skippedCount} 个不支持的类型或超过 5MB 的文件`);
    }

    setImporting(true);
    try {
      const files: KnowledgeImportFile[] = await Promise.all(
        accepted.map(async (file) => {
          const relPath =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          if (BINARY_FILE_RE.test(file.name)) {
            return { path: relPath, content: await readAsBase64(file), encoding: 'base64' as const };
          }
          return { path: relPath, content: await file.text() };
        }),
      );
      const report = await importKnowledgeFiles(files);
      const message = formatReport(report);
      // 部分文件失败属可继续的告警,不应报成功
      if (report.errors.length > 0) toast.warning(message);
      else toast.success(message);
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
        {/* 导入(多选)/导出:导出的是 zip,解压后可直接用「选择文件夹」导回 */}
        {localAccess && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={exporting}
              onClick={() => void onExport()}
            >
              <Download className="size-3.5" />
              {exporting ? '导出中…' : '导出'}
            </Button>
            <Popover open={importMenuOpen} onOpenChange={setImportMenuOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" disabled={importing}>
                  <Import className="size-3.5" />
                  {importing ? '导入中…' : '导入'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-1">
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left"
                  onClick={() => {
                    setImportMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <FileUp className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">选择文件…</span>
                    <span className="text-muted-foreground block text-xs">
                      可多选:Markdown/文本 + PDF/图片/Word
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left"
                  onClick={() => {
                    setImportMenuOpen(false);
                    folderInputRef.current?.click();
                  }}
                >
                  <FolderUp className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">选择文件夹…</span>
                    <span className="text-muted-foreground block text-xs">保留目录结构,支持文本与附件</span>
                  </span>
                </button>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </header>

      {/* 文件选择器由浏览器 File API 读取,不经过 preload,不暴露任意路径读取能力 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.json,.csv,.html,.htm,.yml,.yaml,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.docx"
        className="hidden"
        onChange={(event) => {
          const input = event.currentTarget;
          void importPickedFiles(input.files).finally(() => { input.value = ''; });
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as unknown as InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) => {
          const input = event.currentTarget;
          void importPickedFiles(input.files).finally(() => { input.value = ''; });
        }}
      />

      <div className="flex-1 overflow-hidden p-2">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={narrow ? '22%' : '28%'} minSize={narrow ? '14%' : '18%'}>
            <div className="flex h-full flex-col gap-2">
              <div className="min-h-0 flex-1">
                <KnowledgeTree onRefresh={() => void load()} refreshing={loading} />
              </div>
            </div>
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
