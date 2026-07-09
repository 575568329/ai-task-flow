// frontend/src/components/knowledge/KnowledgeViewer.tsx
// 文档查看器:按 kind 分流(md→markdown / img→图 / pdf·html→iframe / docx→下载)。
// 工具栏:md 可导出 PDF(新窗口打印→浏览器另存为 PDF);所有类型可下载原文件。
import { useEffect, useRef, useState } from 'react';
import { Trash2, Printer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { fetchDoc, getRawUrl, deleteDoc, fetchManifest } from '@/api/knowledge';
import { MessageContent } from '@/components/chat/MessageContent';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';

export function KnowledgeViewer() {
  const getCurrentDoc = useKnowledgeStore((s) => s.getCurrentDoc);
  const currentPath = useKnowledgeStore((s) => s.currentPath);
  const setCurrentPath = useKnowledgeStore((s) => s.setCurrentPath);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const { confirm } = useConfirm();

  const doc = getCurrentDoc();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // md 文档:currentPath 变化时拉取正文
  useEffect(() => {
    if (!currentPath) {
      setContent('');
      return;
    }
    const node = getCurrentDoc();
    if (!node || node.kind !== 'md') {
      setContent('');
      return;
    }
    setLoading(true);
    fetchDoc(currentPath)
      .then((res) => setContent(res.content ?? ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  if (!currentPath || !doc) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center rounded-md border text-sm">
        选择左侧文档查看
      </div>
    );
  }

  const onDelete = async () => {
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
      `<!doctype html><html><head><meta charset="utf-8"><title>${doc.title}</title>${styles}<style>body{padding:32px;max-width:900px;margin:0 auto;}</style></head><body>${el.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    // 留时间给样式表(link)加载完成
    setTimeout(() => win.print(), 500);
  };

  /** 下载原始文件(fetch→blob→a[download],避免浏览器内联打开 pdf/html/img) */
  const onDownload = async () => {
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

  const isFrame = doc.kind === 'pdf' || doc.kind === 'html';

  return (
    <div className="bg-card flex h-full flex-col rounded-md border">
      <header className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{doc.title}</span>
        {doc.tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
            {tag}
          </Badge>
        ))}
        {doc.kind === 'md' && (
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
          onClick={onDelete}
          aria-label="删除文档"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </header>

      {isFrame ? (
        <iframe
          src={getRawUrl(doc.path)}
          title={doc.title}
          className="flex-1 border-0"
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4" ref={contentRef}>
            {doc.kind === 'md' &&
              (loading ? (
                <div className="text-muted-foreground text-sm">加载中…</div>
              ) : (
                <MessageContent content={content} />
              ))}
            {doc.kind === 'img' && (
              <img
                src={getRawUrl(doc.path)}
                alt={doc.title}
                className="max-w-full rounded"
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
