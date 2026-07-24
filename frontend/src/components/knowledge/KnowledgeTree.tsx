// frontend/src/components/knowledge/KnowledgeTree.tsx
// 知识库左侧:新建笔记 + 搜索 + 标签筛选 + 目录树(无筛选时)/ 扁平结果(有筛选时)。
// 树默认全收起(根节点「知识库」明显加粗),顶部提供全部展开/全部收起 + 刷新。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Search,
  Folder,
  FolderOpen,
  FileText,
  FilePlus,
  RefreshCw,
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  Star,
  Sparkles,
} from 'lucide-react';
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
import { Collapse } from '@/components/ui/collapse';
import { cn } from '@/lib/utils';
import { useKnowledgeStore, isRecentMtime } from '@/stores/knowledgeStore';
import { formatRelativeTime } from '@/lib/formatDate';
import { createDoc, fetchManifest } from '@/api/knowledge';
import { toast } from '@/components/ui/toaster';

/** 递归收集所有目录节点 name(用于默认全收起 / 全部收起) */
function collectDirNames(node: KnowledgeNode, acc: Set<string>): void {
  if (node.type === 'dir') {
    acc.add(node.name);
    node.children.forEach((c) => collectDirNames(c, acc));
  }
}

interface KnowledgeTreeProps {
  /** 手动刷新回调(刷新整棵 manifest) */
  onRefresh?: () => void;
  /** 刷新中状态(用于按钮禁用 + 图标旋转) */
  refreshing?: boolean;
}

export function KnowledgeTree({ onRefresh, refreshing }: KnowledgeTreeProps) {
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
  const favorites = useKnowledgeStore((s) => s.favorites);
  const toggleFavorite = useKnowledgeStore((s) => s.toggleFavorite);
  const filterFavorites = useKnowledgeStore((s) => s.filterFavorites);
  const setFilterFavorites = useKnowledgeStore((s) => s.setFilterFavorites);
  const filterRecent = useKnowledgeStore((s) => s.filterRecent);
  const setFilterRecent = useKnowledgeStore((s) => s.setFilterRecent);

  // 所有目录 name 集合(manifest 就绪后计算一次)
  const allDirNames = useMemo(() => {
    if (!manifest) return new Set<string>();
    const acc = new Set<string>();
    manifest.tree.children.forEach((c) => collectDirNames(c, acc));
    return acc;
  }, [manifest]);

  // 预计算每个目录子树是否含「新文件 / 收藏文件」,renderNode 直接查表,
  // 避免每个目录节点递归整棵子树(O(n²)→O(n));manifest / favorites 变化时重算。
  // WeakMap 以 node 对象为 key,避开 path / name 唯一性问题。
  const dirFlags = useMemo(() => {
    const flags = new WeakMap<KnowledgeNode, { hasRecent: boolean; hasFavorite: boolean }>();
    if (!manifest) return flags;
    const visit = (node: KnowledgeNode): { hasRecent: boolean; hasFavorite: boolean } => {
      if (node.type === 'file') {
        return { hasRecent: isRecentMtime(node.mtime), hasFavorite: favorites.includes(node.path) };
      }
      let hasRecent = false;
      let hasFavorite = false;
      for (const child of node.children) {
        const r = visit(child);
        if (r.hasRecent) hasRecent = true;
        if (r.hasFavorite) hasFavorite = true;
      }
      flags.set(node, { hasRecent, hasFavorite });
      return { hasRecent, hasFavorite };
    };
    visit(manifest.tree);
    return flags;
  }, [manifest, favorites]);

  // collapsed 集合:默认全收起(所有目录都在集合里);manifest 首次就绪时初始化
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [inited, setInited] = useState(false);
  useEffect(() => {
    if (!inited && manifest && allDirNames.size > 0) {
      setCollapsed(new Set(allDirNames));
      setInited(true);
    }
  }, [inited, manifest, allDirNames]);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // manifest 切换(切换知识库根)时重置展开态,重新默认全收起
  useEffect(() => {
    setInited(false);
  }, [manifest?.tree.name]);

  if (!manifest) return null;

  const hasFilter =
    searchQuery.trim().length > 0 ||
    selectedTags.length > 0 ||
    filterFavorites ||
    filterRecent;

  const toggleDir = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allDirNames));

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
      const flags = dirFlags.get(node);
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
            {flags?.hasRecent && (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-600">
                新
              </span>
            )}
            {flags?.hasFavorite && (
              <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
            )}
          </button>
          <Collapse open={isOpen}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </Collapse>
        </div>
      );
    }
    const active = currentPath === node.path;
    const fav = favorites.includes(node.path);
    return (
      <button
        type="button"
        key={node.path}
        className={cn(
          'group hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm',
          active && 'bg-accent'
        )}
        style={{ paddingLeft: depth * 12 + 20 }}
        onClick={() => setCurrentPath(node.path)}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.title}</span>
        {isRecentMtime(node.mtime) && (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-600">
            新
          </span>
        )}
        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
          {formatRelativeTime(node.mtime)}
        </span>
        {/* 收藏星:已收藏常显(实心黄),未收藏 hover 显;点击切换,stopPropagation 避免触发选中文档 */}
        <span
          role="button"
          tabIndex={0}
          aria-label={fav ? '取消收藏' : '收藏'}
          title={fav ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(node.path);
          }}
          className={cn(
            'shrink-0 cursor-pointer',
            fav ? 'opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100',
          )}
        >
          <Star className={cn('size-3', fav && 'fill-amber-400 text-amber-400')} />
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
          {/* 刷新:紧贴文件树,图标+文字,加载中旋转 */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1 px-2"
            onClick={onRefresh}
            disabled={refreshing}
            title="刷新知识库"
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            刷新
          </Button>
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
        {/* 快捷过滤:仅收藏 / 近 3 天新内容(toggle,激活=primary) */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={filterFavorites ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setFilterFavorites(!filterFavorites)}
            title="只看收藏的文档"
          >
            <Star className={cn('size-3', filterFavorites && 'fill-current')} />
            仅收藏
          </Button>
          <Button
            size="sm"
            variant={filterRecent ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setFilterRecent(!filterRecent)}
            title="只看最近 3 天新增/更新的文档"
          >
            <Sparkles className="size-3" />
            近 3 天
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1">
          {hasFilter ? (
            getFilteredDocs().length === 0 ? (
              <div className="text-muted-foreground p-2 text-xs">无匹配文档</div>
            ) : (
              getFilteredDocs().map((doc) => {
                const fav = favorites.includes(doc.path);
                return (
                  <button
                    type="button"
                    key={doc.path}
                    className={cn(
                      'group hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm',
                      currentPath === doc.path && 'bg-accent'
                    )}
                    onClick={() => setCurrentPath(doc.path)}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{doc.title}</span>
                    {isRecentMtime(doc.mtime) && (
                      <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-600">
                        新
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                      {formatRelativeTime(doc.mtime)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={fav ? '取消收藏' : '收藏'}
                      title={fav ? '取消收藏' : '收藏'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(doc.path);
                      }}
                      className={cn(
                        'shrink-0 cursor-pointer',
                        fav ? 'opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <Star className={cn('size-3', fav && 'fill-amber-400 text-amber-400')} />
                    </span>
                  </button>
                );
              })
            )
          ) : (
            <>
              {/* 全部展开 / 全部收起(仅树模式显示) */}
              <div className="flex items-center gap-1 px-1 pb-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground h-7 gap-1 px-1.5 text-xs"
                  onClick={expandAll}
                  title="展开全部目录"
                >
                  <ChevronsUpDown className="size-3.5" />
                  全部展开
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground h-7 gap-1 px-1.5 text-xs"
                  onClick={collapseAll}
                  title="收起全部目录"
                >
                  <ChevronsDownUp className="size-3.5" />
                  全部收起
                </Button>
              </div>
              {/* 根节点:知识库(明显加粗) */}
              <div className="flex items-center gap-1 rounded px-1 py-1">
                <Database className="size-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-bold">{manifest.tree.title}</span>
              </div>
              {manifest.tree.children.map((child) => renderNode(child, 0))}
            </>
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
