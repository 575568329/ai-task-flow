// frontend/src/components/knowledge/KnowledgeViewer.tsx
// 文档查看器:按 kind 分流(md 可编辑/预览 / img / pdf·html iframe / docx 下载)。
// md 支持:编辑/预览切换、Ctrl+S 保存(PUT saveDoc)。新建入口在 KnowledgeTree(目录树顶部)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Printer, Download, Pencil, Eye, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { fetchDoc, getRawUrl, deleteDoc, fetchManifest, saveDoc } from '@/api/knowledge';
import { MessageContent } from '@/components/chat/MessageContent';
import { MdEditor } from './MdEditor';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';
import { usePreviewStore } from '@/stores/previewStore';

export function KnowledgeViewer() {
  const getCurrentDoc = useKnowledgeStore((s) => s.getCurrentDoc);
  const currentPath = useKnowledgeStore((s) => s.currentPath);
  const setCurrentPath = useKnowledgeStore((s) => s.setCurrentPath);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const mode = useKnowledgeStore((s) => s.mode);
  const setMode = useKnowledgeStore((s) => s.setMode);
  const { confirm } = useConfirm();

  const doc = getCurrentDoc();
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const isMd = doc?.kind === 'md';
  const dirty = isMd && draft !== original;

  // 文档切换:拉取正文 + 重置基线(mode 由 store 管:切文档自动 view,新建后 edit)
  useEffect(() => {
    if (!currentPath || !doc || doc.kind !== 'md') {
      setDraft('');
      setOriginal('');
      return;
    }
    setLoading(true);
    fetchDoc(currentPath)
      .then((res) => {
        const c = res.content ?? '';
        setDraft(c);
        setOriginal(c);
      })
      .catch(() => {
        setDraft('');
        setOriginal('');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const refreshManifest = async () => {
    setManifest(await fetchManifest());
  };

  // 保存(覆盖已有文档)
  const onSave = useCallback(async () => {
    if (!currentPath || !isMd) return;
    setSaving(true);
    try {
      await saveDoc(currentPath, draft);
      setOriginal(draft);
      await refreshManifest();
      toast.success('已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, draft, isMd]);

  // Ctrl/Cmd+S 快捷保存(仅编辑态)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && mode === 'edit' && isMd) {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, isMd, onSave]);

  const onDelete = async () => {
    if (!doc) return;
    if (
      !(await confirm({
        title: '删除文档',
        description: `确认删除「${doc.title}」?`,
        variant: 'destructive',
      }))
    )
      return;
    try {
      await deleteDoc(doc.path);
      setManifest(await fetchManifest());
      setCurrentPath(null);
      toast.success('已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  /** md 导出 PDF:新窗口写入渲染后 HTML + 当前页样式,调浏览器打印(另存为 PDF) */
  const onExportPdf = () => {
    const el = contentRef.current;
    if (!el) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      toast.error('请允许弹窗以导出 PDF');
      return;
    }
    // 复制当前页样式表,保证 Tailwind class 在新窗口生效,渲染与页面一致
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((n) => n.outerHTML)
      .join('\n');
    win.document.open();
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${doc?.title ?? ''}</title>${styles}<style>body{padding:32px;max-width:900px;margin:0 auto;}</style></head><body>${el.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    // 留时间给样式表(link)加载完成
    setTimeout(() => win.print(), 500);
  };

  /** 下载原始文件(fetch→blob→a[download],避免浏览器内联打开 pdf/html/img) */
  const onDownload = async () => {
    if (!doc) return;
    try {
      const res = await fetch(getRawUrl(doc.path));
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败');
    }
  };

  const isFrame = doc?.kind === 'pdf' || doc?.kind === 'html';

  return (
    <div className="bg-card flex h-full flex-col rounded-md border">
      <header className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {doc?.title ?? '未选择文档'}
        </span>
        {doc?.tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
            {tag}
          </Badge>
        ))}

        {/* md 编辑/预览切换 + 保存(仅当前文档操作,新建在左侧目录树) */}
        {isMd && mode === 'view' && (
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground size-7"
            onClick={() => setMode('edit')}
            aria-label="编辑"
            title="编辑"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {isMd && mode === 'edit' && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={() => setMode('view')}
              aria-label="预览"
              title="预览"
            >
              <Eye className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant={dirty ? 'default' : 'ghost'}
              className="size-7"
              onClick={() => void onSave()}
              disabled={saving || !dirty}
              aria-label="保存"
              title="保存 (Ctrl+S)"
            >
              <Save className="size-3.5" />
            </Button>
          </>
        )}

        {doc && (
          <>
            {isMd && mode === 'view' && (
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-7"
                onClick={onExportPdf}
                aria-label="导出 PDF"
                title="导出 PDF"
              >
                <Printer className="size-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={() => void onDownload()}
              aria-label="下载原文件"
              title="下载原文件"
            >
              <Download className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive size-7"
              onClick={() => void onDelete()}
              aria-label="删除文档"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </header>

      {/* body:按类型分流 */}
      {!doc ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-sm">
          选择左侧文档查看,或点左上角 + 新建笔记
        </div>
      ) : isFrame ? (
        <iframe src={getRawUrl(doc.path)} title={doc.title} className="flex-1 border-0" />
      ) : isMd && mode === 'edit' ? (
        <div className="flex-1 overflow-hidden">
          <MdEditor value={draft} onChange={setDraft} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4" ref={contentRef}>
            {isMd &&
              (loading ? (
                <div className="text-muted-foreground text-sm">加载中…</div>
              ) : (
                <MessageContent content={draft} />
              ))}
            {doc.kind === 'img' && (
              <img
                src={getRawUrl(doc.path)}
                alt={doc.title}
                className="max-w-full cursor-zoom-in rounded"
                onClick={() => usePreviewStore.getState().open(getRawUrl(doc.path))}
              />
            )}
            {doc.kind === 'docx' && (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
                <p>docx 暂不支持在线预览</p>
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void onDownload()}
                >
                  下载查看
                </button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
