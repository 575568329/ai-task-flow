// frontend/src/components/views/MindmapView.tsx
// 思维导图视图：列表页（空状态/新建/打开/删除/复制）+ 编辑页（Toolbar + 画布）。
// keep-alive 架构下本视图常驻（hidden 切换）；有 current 显示编辑器，否则列表。
import { useEffect, useState } from 'react';
import { Network, Plus, Trash2, Copy, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMindmapStore, type MindmapSaveStatus } from '@/stores/mindmapStore';
import type { MindmapMetaDTO } from '@ai-task-flow/shared';
import { MindmapEditor } from '@/components/mindmap/MindmapEditor';

export function MindmapView() {
  const current = useMindmapStore((s) => s.current);
  return current ? <EditorPage /> : <ListPage />;
}

// ============ 列表页 ============

function ListPage() {
  const list = useMindmapStore((s) => s.list);
  const loading = useMindmapStore((s) => s.listLoading);
  const fetchList = useMindmapStore((s) => s.fetchList);
  const createDoc = useMindmapStore((s) => s.createDoc);
  const openDoc = useMindmapStore((s) => s.openDoc);
  const deleteDoc = useMindmapStore((s) => s.deleteDoc);
  const duplicateDoc = useMindmapStore((s) => s.duplicateDoc);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleCreate = async () => {
    const id = await createDoc();
    if (id) void openDoc(id);
  };

  if (loading && list.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Network className="size-5" />
          <h1 className="text-lg font-semibold">思维导图</h1>
        </div>
        <Button onClick={handleCreate} size="sm">
          <Plus className="mr-1 size-4" /> 新建
        </Button>
      </header>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {list.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((m) => (
                <DocCard
                  key={m.id}
                  meta={m}
                  onOpen={() => void openDoc(m.id)}
                  onDelete={() => void deleteDoc(m.id)}
                  onDuplicate={() => void duplicateDoc(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <Network className="text-muted-foreground/50 size-12" />
      <div>
        <p className="text-lg font-medium">开始你的第一张思维导图</p>
        <p className="text-muted-foreground text-sm">梳理思路、拆解任务、可视化笔记</p>
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-1 size-4" /> 新建思维导图
      </Button>
    </div>
  );
}

function DocCard({
  meta,
  onOpen,
  onDelete,
  onDuplicate,
}: {
  meta: MindmapMetaDTO;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className="group bg-card relative rounded-lg border p-4 transition-shadow hover:shadow-md">
      <button className="w-full text-left" onClick={onOpen}>
        <h3 className="truncate font-medium">{meta.title}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {meta.nodeCount} 个节点 · {formatDate(meta.updatedAt)}
        </p>
      </button>
      <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDuplicate} title="复制">
          <Copy className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
          onClick={onDelete}
          title="删除"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============ 编辑页 ============

function EditorPage() {
  const current = useMindmapStore((s) => s.current)!;
  const isDirty = useMindmapStore((s) => s.isDirty);
  const saveStatus = useMindmapStore((s) => s.saveStatus);
  const closeDoc = useMindmapStore((s) => s.closeDoc);
  const renameCurrent = useMindmapStore((s) => s.renameCurrent);
  const triggerAutoLayout = useMindmapStore((s) => s.triggerAutoLayout);
  const [title, setTitle] = useState(current.title);

  // 文档切换时同步标题输入框
  useEffect(() => {
    setTitle(current.title);
  }, [current.id]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== current.title) {
      void renameCurrent(trimmed);
    } else if (!trimmed) {
      setTitle(current.title); // 空标题回退
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b p-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={closeDoc} title="返回列表">
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="h-8 max-w-xs border-none bg-transparent hover:bg-accent focus-visible:bg-background"
          placeholder="文档标题"
        />
        <SaveBadge isDirty={isDirty} status={saveStatus} />
        <Button variant="outline" size="sm" className="ml-2 h-8" onClick={triggerAutoLayout}>
          <Sparkles className="mr-1 size-3.5" /> 自动布局
        </Button>
        <span className="text-muted-foreground ml-auto pr-2 text-xs">{current.nodeCount} 节点</span>
      </header>
      <div className="flex-1 overflow-hidden">
        {/* key=current.id：文档切换时整体重新挂载，受控 state 从新 current 重新初始化 */}
        <MindmapEditor key={current.id} />
      </div>
    </div>
  );
}

function SaveBadge({ isDirty, status }: { isDirty: boolean; status: MindmapSaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Loader2 className="size-3 animate-spin" /> 保存中…
      </span>
    );
  }
  if (status === 'error') return <span className="text-destructive text-xs">保存失败</span>;
  if (isDirty) return <span className="text-muted-foreground text-xs">● 未保存</span>;
  return <span className="text-muted-foreground text-xs">已保存</span>;
}

/** 相对时间格式化 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString();
}
