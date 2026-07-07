// frontend/src/components/StorageManager.tsx
// 存储管理弹窗:展示各类别占用,按类别清理(仅 clearable),刷新后回写 storageWarn。
import { useEffect, useState } from 'react';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { systemApi } from '@/api/task';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/components/ui/Toaster';
import { useConfirm } from '@/components/ui/confirm';
import type {
  StorageInfo,
  StorageItem,
  StorageCategoryKey,
} from '@ai-task-flow/shared';
import { cn } from '@/lib/utils';

interface StorageManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 字节 → 人类可读(KB/MB/GB) */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  return `${(bytes / KB).toFixed(1)} KB`;
}

export function StorageManager({ open, onOpenChange }: StorageManagerProps) {
  const setStorageWarn = useUIStore((s) => s.setStorageWarn);
  const { confirm } = useConfirm();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<StorageCategoryKey>>(new Set());
  const [clearing, setClearing] = useState(false);

  // 打开时拉取占用,默认勾选所有超阈值的可清理项
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    systemApi
      .getStorage()
      .then((data) => {
        setInfo(data);
        setSelected(
          new Set(
            data.items
              .filter((item) => item.clearable && item.warning)
              .map((item) => item.key),
          ),
        );
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '获取存储信息失败');
      })
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (key: StorageCategoryKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const handleClear = async () => {
    const targets = Array.from(selected);
    if (targets.length === 0) return;

    // danger 项需强提示副作用
    const dangerItems = info?.items.filter(
      (item) => targets.includes(item.key) && item.danger,
    );
    if (dangerItems && dangerItems.length > 0) {
      const names = dangerItems.map((i) => i.label).join('、');
      const descriptions = dangerItems.map((i) => i.description).join('\n');
      if (
        !(await confirm({
          title: `清理 ${names} 有副作用`,
          description: `${descriptions}\n\n确认继续?`,
          confirmText: '继续清理',
          variant: 'destructive',
        }))
      ) {
        return;
      }
    }

    setClearing(true);
    try {
      const res = await systemApi.clearStorage(targets);
      setInfo(res.storage);
      setStorageWarn(res.storage.warning);
      // 清理后清空选中(已清的项 bytes 归零,无需再选)
      setSelected(new Set());
      const released = res.results.reduce((sum, r) => sum + r.releasedBytes, 0);
      toast.success(`已释放 ${formatBytes(released)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>存储管理</DialogTitle>
          <DialogDescription>
            查看数据目录占用并清理缓存。业务数据(任务/聊天)不可整体清理。
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        )}

        {info && !loading && (
          <>
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">总占用</span>
              <span className={cn('font-semibold', info.warning && 'text-destructive')}>
                {formatBytes(info.totalBytes)}
                {info.warning && (
                  <AlertTriangle className="ml-1 inline size-3.5 align-text-bottom" />
                )}
              </span>
            </div>

            <ScrollArea className="max-h-72 pr-3">
              <div className="flex flex-col gap-2">
                {info.items.map((item: StorageItem) => (
                  <StorageRow
                    key={item.key}
                    item={item}
                    checked={selected.has(item.key)}
                    onToggle={() => toggle(item.key)}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            onClick={() => void handleClear()}
            disabled={clearing || selected.size === 0}
          >
            {clearing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            清理选中({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StorageRowProps {
  item: StorageItem;
  checked: boolean;
  onToggle: () => void;
}

function StorageRow({ item, checked, onToggle }: StorageRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 rounded-md border p-2 text-sm',
        item.warning && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex h-5 items-center">
        {item.clearable ? (
          <Checkbox checked={checked} onCheckedChange={onToggle} />
        ) : (
          <span className="text-muted-foreground/50 px-2 text-xs">—</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{item.label}</span>
          {item.danger && (
            <Badge variant="destructive" className="px-1 py-0 text-[10px]">
              谨慎
            </Badge>
          )}
          {item.warning && (
            <Badge variant="outline" className="border-destructive/50 text-destructive px-1 py-0 text-[10px]">
              超阈值
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{item.description}</p>
      </div>
      <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatBytes(item.bytes)}
      </div>
    </label>
  );
}
