// frontend/src/components/docs/FileTree.tsx
// 文件树浏览:懒加载目录(点开才 listFiles),目录/文件分层缩进。
// 用于"项目文件"tab 浏览挂载文件夹;refreshSignal 变化时重新加载已展开目录,捕获新增/改动。
// 顶部提供「全部展开 / 全部收起」:全部展开时 BFS 递归懒加载所有子目录。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listFiles, type FileEntry } from '@/api/files';
import { Collapse } from '@/components/ui/collapse';
import { cn } from '@/lib/utils';

interface FileTreeProps {
  root: string;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  /** 手动刷新信号:递增触发,变化时重新加载所有已展开目录(保留展开态) */
  refreshSignal?: number;
}

export function FileTree({ root, selectedFile, onSelectFile, refreshSignal }: FileTreeProps) {
  // 已加载目录内容:sub path → entries('' 为根)
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expanding, setExpanding] = useState(false);

  // root 切换判断 + 展开态最新值(ref 绕过 effect 依赖,避免展开即重载)
  const rootRef = useRef(root);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const prevRoot = rootRef.current;
    rootRef.current = root;
    // root 切换 → 重置并加载根目录
    if (prevRoot !== root) {
      setTree({});
      setExpanded(new Set());
      listFiles(root)
        .then((res) => setTree({ '': res.entries }))
        .catch(() => setTree({}));
      return;
    }
    // refreshSignal 变化 → 重新加载根 + 所有已展开目录(捕获新增/改动,保留展开态)
    const subs = ['', ...expandedRef.current];
    Promise.all(
      subs.map(
        (sub): Promise<[string, FileEntry[]]> =>
          listFiles(root, sub || undefined)
            .then((res): [string, FileEntry[]] => [sub, res.entries])
            .catch((): [string, FileEntry[]] => [sub, []]),
      ),
    )
      .then((entries) => {
        const next: Record<string, FileEntry[]> = {};
        for (const [sub, list] of entries) next[sub] = list;
        setTree(next);
      })
      .catch(() => {});
    // refreshSignal 为 undefined 时不触发(首次挂载走 root 分支或加载根)
  }, [root, refreshSignal]);

  const toggle = async (sub: string) => {
    const next = new Set(expanded);
    if (next.has(sub)) {
      next.delete(sub);
    } else {
      next.add(sub);
      if (!tree[sub]) {
        try {
          const res = await listFiles(root, sub || undefined);
          setTree((prev) => ({ ...prev, [sub]: res.entries }));
        } catch {
          setTree((prev) => ({ ...prev, [sub]: [] }));
        }
      }
    }
    setExpanded(next);
  };

  // 全部展开:BFS 递归懒加载所有子目录并标记展开(已加载的复用,避免重复请求)
  const expandAll = async () => {
    setExpanding(true);
    try {
      const newTree: Record<string, FileEntry[]> = { ...tree };
      const newExpanded = new Set<string>();
      const visited = new Set<string>();
      const queue: string[] = [''];
      while (queue.length > 0) {
        const sub = queue.shift()!;
        if (visited.has(sub)) continue;
        visited.add(sub);
        let entries = newTree[sub];
        if (!entries) {
          try {
            const res = await listFiles(root, sub || undefined);
            entries = res.entries;
            newTree[sub] = entries;
          } catch {
            entries = [];
            newTree[sub] = [];
          }
        }
        for (const e of entries) {
          if (e.type === 'dir') {
            newExpanded.add(e.path);
            if (!visited.has(e.path)) queue.push(e.path);
          }
        }
      }
      setTree(newTree);
      setExpanded(newExpanded);
    } finally {
      setExpanding(false);
    }
  };

  const collapseAll = () => setExpanded(new Set());

  const renderDir = (sub: string, depth: number): ReactNode => {
    const entries = tree[sub];
    if (!entries) return null;
    const sorted = [...entries].sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === 'dir'
          ? -1
          : 1,
    );
    return sorted.map((entry) => {
      if (entry.type === 'dir') {
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              className="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm"
              style={{ paddingLeft: depth * 12 + 4 }}
              onClick={() => void toggle(entry.path)}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-200 ease-out',
                  !isOpen && '-rotate-90',
                )}
              />
              {isOpen ? (
                <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-amber-500" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            <Collapse open={isOpen}>{renderDir(entry.path, depth + 1)}</Collapse>
          </div>
        );
      }
      const active = selectedFile === entry.path;
      return (
        <button
          type="button"
          key={entry.path}
          className={cn(
            'hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm',
            active && 'bg-accent',
          )}
          style={{ paddingLeft: depth * 12 + 20 }}
          onClick={() => onSelectFile(entry.path)}
        >
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  };

  return (
    <div className="flex flex-col py-1">
      {/* 全部展开 / 全部收起(懒加载树:全部展开时递归加载所有子目录) */}
      <div className="flex items-center gap-1 px-1 pb-1">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground h-7 gap-1 px-1.5 text-xs"
          onClick={() => void expandAll()}
          disabled={expanding}
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
        {expanding && <Loader2 className="text-muted-foreground ml-auto size-3 animate-spin" />}
      </div>
      {renderDir('', 0)}
    </div>
  );
}
