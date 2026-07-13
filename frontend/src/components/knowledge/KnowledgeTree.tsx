// frontend/src/components/knowledge/KnowledgeTree.tsx
// 知识库左侧:新建笔记 + 搜索 + 标签筛选 + 目录树(无筛选时)/ 扁平结果(有筛选时)。
import { useState, type ReactNode } from 'react';
import { Search, Folder, FolderOpen, FileText, FilePlus } from 'lucide-react';
import type { KnowledgeNode } from '@ai-task-flow/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { formatRelativeTime } from '@/lib/formatDate';
import { createDoc, fetchManifest } from '@/api/knowledge';
import { toast } from '@/components/ui/toaster';

export function KnowledgeTree() {
  const manifest = useKnowledgeStore((s) => s.manifest);
  const currentPath = useKnowledgeStore((s) => s.currentPath);
  const setCurrentPath = useKnowledgeStore((s) => s.setCurrentPath);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const setMode = useKnowledgeStore((s) => s.setMode);
  const searchQuery = useKnowledgeStore((s) => s.searchQuery);
  const setSearchQuery = useKnowledgeStore((s) => s.setSearchQuery);
  const selectedTags = useKnowledgeStore((s) => s.selectedTags);
  const setSelectedTags = useKnowledgeStore((s) => s.setSelectedTags);
  const getFilteredDocs = useKnowledgeStore((s) => s.getFilteredDocs);

  // collapsed 集合:默认展开,点击折叠
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  if (!manifest) return null;

  const hasFilter = searchQuery.trim().length > 0 || selectedTags.length > 0;

  const toggleDir = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  // 新建笔记:服务端生成文件名 → 刷新树 → 打开新文档编辑态
  const onCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error('标题不能为空');
      return;
    }
    setCreating(true);
    try {
      const { path } = await createDoc({ title, content: '' });
      setManifest(await fetchManifest());
      setCurrentPath(path); // store 内已 reset mode='view'
      setMode('edit'); // 覆盖为编辑态(新建后立即编辑)
      setShowCreate(false);
      setNewTitle('');
      toast.success('已创建,开始编辑');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const renderNode = (node: KnowledgeNode, depth: number): ReactNode => {
    if (node.type === 'dir') {
      const key = node.name;
      const isOpen = !collapsed.has(key);
      return (
        <div key={key}>
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm"
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => toggleDir(key)}
          >
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-amber-500" />
            )}
            <span className="truncate font-medium">{node.title}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const active = currentPath === node.path;
    return (
      <button
        type="button"
        key={node.path}
        className={cn(
          'hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm',
          active && 'bg-accent'
        )}
        style={{ paddingLeft: depth * 12 + 20 }}
        onClick={() => setCurrentPath(node.path)}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.title}</span>
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {formatRelativeTime(node.mtime)}
        </span>
      </button>
    );
  };

  return (
    <div className="bg-card flex h-full flex-col rounded-md border">
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索文档…"
              className="h-8 pl-7"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground size-8 shrink-0"
            onClick={() => setShowCreate(true)}
            aria-label="新建笔记"
            title="新建笔记"
          >
            <FilePlus className="size-4" />
          </Button>
        </div>
        {manifest.tags.length > 0 && (
          <MultiSelect
            options={manifest.tags}
            value={selectedTags}
            onChange={setSelectedTags}
            placeholder="按标签筛选"
          />
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1">
          {hasFilter ? (
            getFilteredDocs().length === 0 ? (
              <div className="text-muted-foreground p-2 text-xs">无匹配文档</div>
            ) : (
              getFilteredDocs().map((doc) => (
                <button
                  type="button"
                  key={doc.path}
                  className={cn(
                    'hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm',
                    currentPath === doc.path && 'bg-accent'
                  )}
                  onClick={() => setCurrentPath(doc.path)}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{doc.title}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                    {formatRelativeTime(doc.mtime)}
                  </span>
                </button>
              ))
            )
          ) : (
            manifest.tree.children.map((child) => renderNode(child, 0))
          )}
        </div>
      </ScrollArea>

      {/* 新建笔记 Dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(op) => {
          setShowCreate(op);
          if (!op) setNewTitle('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建笔记</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="笔记标题"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onCreate();
              }}
            />
            <p className="text-muted-foreground text-xs">
              文件名由服务端按命名规则自动生成(时间戳_标题)
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                取消
              </Button>
            </DialogClose>
            <Button size="sm" onClick={() => void onCreate()} disabled={creating}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
