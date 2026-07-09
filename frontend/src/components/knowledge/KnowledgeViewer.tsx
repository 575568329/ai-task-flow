// frontend/src/components/knowledge/KnowledgeViewer.tsx
// 文档查看器:按 kind 分流(md→markdown / img→图 / pdf·html→iframe / docx→下载)。
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
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

  const isFrame = doc.kind === 'pdf' || doc.kind === 'html';

  return (
    <div className="bg-card flex h-full flex-col rounded-md border">
      <header className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="flex-1 truncate text-sm font-semibold">{doc.title}</span>
        {doc.tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
            {tag}
          </Badge>
        ))}
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
          <div className="p-4">
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
                <a
                  href={getRawUrl(doc.path)}
                  download
                  className="text-primary underline"
                >
                  下载查看
                </a>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
