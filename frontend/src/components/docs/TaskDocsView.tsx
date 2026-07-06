// frontend/src/components/docs/TaskDocsView.tsx
// 文档中心:两个来源的 Markdown 只读预览(Resizable 左右分栏)
// - 任务文档:任务列表 → taskApi.getMarkdown 拉存档(后端 buildTaskMarkdown 生成)
// - 项目文件:挂载多个项目文件夹 → FileTree 浏览其中的文件,手动刷新捕获新增/改动
import { useEffect, useState } from 'react';
import {
  FileText,
  FolderOpen,
  FileBox,
  Search,
  Plus,
  X,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { taskApi, systemApi } from '@/api/task';
import { readFile } from '@/api/files';
import { toast } from '@/components/ui/Toaster';
import { MessageContent } from '@/components/chat/MessageContent';
import { FileTree } from './FileTree';

type Mode = 'tasks' | 'files';

const ROOTS_KEY = 'ai-task-flow-doc-roots';
const COLLAPSE_KEY = 'ai-task-flow-doc-roots-collapsed';

function loadRoots(): string[] {
  try {
    const raw = localStorage.getItem(ROOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRoots(roots: string[]): void {
  localStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
}

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollapsed(list: string[]): void {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
}

export function TaskDocsView() {
  const tasks = useTaskStore((s) => s.tasks);
  const fetchAll = useTaskStore((s) => s.fetchAll);

  const [mode, setMode] = useState<Mode>('tasks');

  // 任务文档
  const [query, setQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 项目文件:多 root(挂载的文件夹)
  const [roots, setRoots] = useState<string[]>(() => loadRoots());
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(
    () => new Set(loadCollapsed()),
  );
  const [refreshSignals, setRefreshSignals] = useState<Record<string, number>>({});
  const [activeRoot, setActiveRoot] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');

  // 共享预览
  const [markdown, setMarkdown] = useState('');
  const [loadingMd, setLoadingMd] = useState(false);
  const [error, setError] = useState('');

  // 挂载时确保任务列表已加载(看板可能已拉,重复无害)
  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 默认选第一个任务
  useEffect(() => {
    if (mode === 'tasks' && !selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [mode, selectedTaskId, tasks]);

  // 选任务 → 拉 md 存档
  useEffect(() => {
    if (mode !== 'tasks' || !selectedTaskId) return;
    setLoadingMd(true);
    setError('');
    taskApi
      .getMarkdown(selectedTaskId)
      .then((res) => setMarkdown(res.markdown))
      .catch((e) => setError(e instanceof Error ? e.message : '加载文档失败'))
      .finally(() => setLoadingMd(false));
  }, [mode, selectedTaskId]);

  const filtered = tasks.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  });

  // ---- 项目文件:多 root 操作 ----
  const handleAddFolder = async () => {
    try {
      const res = await systemApi.selectDirectory();
      if (!res.path) return;
      if (roots.includes(res.path)) {
        toast.info('该项目已在列表中');
        return;
      }
      const next = [...roots, res.path];
      setRoots(next);
      saveRoots(next);
      setActiveRoot(res.path);
    } catch {
      toast.error('选择文件夹失败');
    }
  };

  const handleRemoveRoot = (root: string) => {
    if (
      !window.confirm(
        `确定移除该项目吗?\n${root}\n\n仅从列表移除,不会删除磁盘上的任何文件。`,
      )
    )
      return;
    const next = roots.filter((r) => r !== root);
    setRoots(next);
    saveRoots(next);
    setCollapsedRoots((prev) => {
      const cp = new Set(prev);
      cp.delete(root);
      saveCollapsed([...cp]);
      return cp;
    });
    if (activeRoot === root) {
      setActiveRoot(next[0] ?? '');
      setSelectedFilePath('');
      setMarkdown('');
    }
  };

  const handleRefreshRoot = (root: string) => {
    setRefreshSignals((s) => ({ ...s, [root]: (s[root] ?? 0) + 1 }));
  };

  const handleToggleCollapse = (root: string) => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      saveCollapsed([...next]);
      return next;
    });
  };

  const handleSelectFile = async (root: string, filePath: string) => {
    setActiveRoot(root);
    setSelectedFilePath(filePath);
    setLoadingMd(true);
    setError('');
    try {
      const content = await readFile(root, filePath);
      setMarkdown(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取文件失败');
      setMarkdown('');
    } finally {
      setLoadingMd(false);
    }
  };

  const previewEmpty =
    (mode === 'tasks' && !selectedTaskId) ||
    (mode === 'files' && !selectedFilePath);

  return (
    <div className="h-full">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {/* 左栏:Tab + 列表 */}
        <ResizablePanel defaultSize={28} minSize={18}>
          <div className="flex h-full flex-col border-r">
            {/* Tab 切换 */}
            <div className="flex border-b">
              <button
                type="button"
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
                  mode === 'tasks'
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setMode('tasks')}
              >
                <FileText className="size-4" /> 任务文档
              </button>
              <button
                type="button"
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
                  mode === 'files'
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setMode('files')}
              >
                <FolderOpen className="size-4" /> 项目文件
              </button>
            </div>

            {mode === 'tasks' ? (
              <>
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索任务标题 / ID"
                      className="h-8 pl-7 text-sm"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-1">
                  {filtered.length === 0 ? (
                    <div className="text-muted-foreground p-3 text-center text-xs">
                      暂无任务
                    </div>
                  ) : (
                    filtered.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                          selectedTaskId === t.id ? 'bg-accent' : 'hover:bg-accent/50',
                        )}
                        onClick={() => setSelectedTaskId(t.id)}
                      >
                        <div className="truncate text-sm">{t.title || '(无标题)'}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                          <span className="text-muted-foreground">{t.status}</span>
                          <span className="text-muted-foreground/60">{t.id}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="border-b p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void handleAddFolder()}
                  >
                    <Plus className="size-4" /> 添加项目文件夹
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-1">
                  {roots.length === 0 ? (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs">
                      <FileBox className="size-8 opacity-40" />
                      <p>
                        添加一个项目文件夹后
                        <br />
                        在此浏览文件
                      </p>
                    </div>
                  ) : (
                    roots.map((root) => {
                      const collapsed = collapsedRoots.has(root);
                      return (
                        <div key={root} className="mb-1">
                          <div className="group flex items-center gap-1 rounded-md px-1 py-1">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              onClick={() => handleToggleCollapse(root)}
                              aria-label={collapsed ? '展开' : '收起'}
                            >
                              {collapsed ? (
                                <ChevronRight className="size-3.5" />
                              ) : (
                                <ChevronDown className="size-3.5" />
                              )}
                            </button>
                            <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
                            <span className="flex-1 truncate text-xs" title={root}>
                              {root}
                            </span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => handleRefreshRoot(root)}
                              aria-label="刷新"
                              title="刷新(捕获新增/改动)"
                            >
                              <RefreshCw className="size-3" />
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => handleRemoveRoot(root)}
                              aria-label="移除"
                              title="移除该项目"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                          {!collapsed && (
                            <FileTree
                              root={root}
                              selectedFile={activeRoot === root ? selectedFilePath : null}
                              onSelectFile={(path) => void handleSelectFile(root, path)}
                              refreshSignal={refreshSignals[root]}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右栏:Markdown 预览(两 Tab 共享) */}
        <ResizablePanel defaultSize={72} minSize={30}>
          <div className="h-full overflow-y-auto">
            {previewEmpty ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
                {mode === 'files' && roots.length === 0 ? (
                  <FolderOpen className="size-12 opacity-30" />
                ) : (
                  <FileText className="size-12 opacity-30" />
                )}
                <p>
                  {mode === 'tasks'
                    ? '选择左侧任务查看其 Markdown 文档'
                    : roots.length === 0
                      ? '先添加一个项目文件夹'
                      : '选择左侧文件查看其内容'}
                </p>
              </div>
            ) : error ? (
              <div className="text-destructive p-6 text-sm">{error}</div>
            ) : loadingMd ? (
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="size-5 animate-spin" /> 加载文档中…
              </div>
            ) : (
              <div className="p-4">
                <MessageContent content={markdown} />
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
