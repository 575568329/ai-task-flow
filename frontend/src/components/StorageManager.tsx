// frontend/src/components/StorageManager.tsx
// 存储占用监控 + 按类清理。
// - 业务数据(tasks/chats)只显示大小,不提供整体清理。
// - 可清理项(events/uploads/taskDocs/logs)行内带"清理"按钮,二次确认后执行。
// - 超单项阈值(50MB)红色高亮,超总阈值(100MB)顶部横幅提示。
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import type { StorageInfo, StorageItem, StorageCategoryKey } from '@ai-task-flow/shared';
import { systemApi } from '@/api/task';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/Toaster';

/** 字节数格式化为人类可读(B/KB/MB/GB) */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function StorageManager() {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<StorageCategoryKey | null>(null);
  const [confirmItem, setConfirmItem] = useState<StorageItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStorage(await systemApi.getStorage());
    } catch {
      // getStorage 已 silent,失败不弹错
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function doClear() {
    const item = confirmItem;
    if (!item) return;
    setConfirmItem(null);
    setBusyKey(item.key);
    try {
      const { results, storage: latest } = await systemApi.clearStorage([item.key]);
      setStorage(latest);
      const released = results.find((r) => r.key === item.key)?.releasedBytes ?? 0;
      toast.success(`已清理 ${item.label},释放 ${formatBytes(released)}`);
    } catch {
      toast.error('清理失败');
    } finally {
      setBusyKey(null);
    }
  }

  if (loading || !storage) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)' }}>统计中…</div>;
  }

  return (
    <div className="sp-storage">
      {/* 总占用 + 刷新 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          总占用 <b style={{ color: storage.warning ? 'var(--error-8)' : 'var(--text-1)', fontSize: 15 }}>
            {formatBytes(storage.totalBytes)}
          </b>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="重新统计"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-fast hover:opacity-80"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 总阈值告警横幅 */}
      {storage.warning && (
        <div
          className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
          style={{ marginBottom: 12, backgroundColor: 'var(--error-1)', color: 'var(--error-8)' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>总占用已超过 100MB,建议清理「事件日志」「运行日志」等可安全清理项。</span>
        </div>
      )}

      {/* 类别列表 */}
      <ul className="flex flex-col gap-1.5">
        {storage.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
            style={{
              backgroundColor: 'var(--surface-1)',
              border: item.warning ? '1px solid var(--error-6)' : '1px solid var(--border-primary)',
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                  {item.label}
                </span>
                {item.warning && (
                  <span className="inline-flex items-center gap-0.5 text-xs" style={{ color: 'var(--error-8)' }}>
                    <AlertTriangle size={11} /> 超限
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }} title={item.description}>
                {item.description}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{formatBytes(item.bytes)}</span>
                {item.fileCount > 0 && <span>· {item.fileCount} 个文件</span>}
              </div>
            </div>

            {item.clearable ? (
              <button
                onClick={() => setConfirmItem(item)}
                disabled={busyKey === item.key}
                className="inline-flex shrink-0 items-center gap-1 rounded px-2.5 py-1.5 text-xs transition-fast hover:opacity-80 disabled:opacity-40"
                style={{
                  backgroundColor: item.danger ? 'var(--error-1)' : 'var(--surface-2)',
                  color: item.danger ? 'var(--error-8)' : 'var(--text-2)',
                }}
              >
                <Trash2 size={12} />
                {busyKey === item.key ? '清理中' : '清理'}
              </button>
            ) : (
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>
                业务数据
              </span>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!confirmItem}
        title={`清理「${confirmItem?.label ?? ''}」`}
        danger={!!confirmItem?.danger}
        confirmText="确认清理"
        message={
          <>
            <div style={{ marginBottom: 8 }}>{confirmItem?.description}</div>
            {confirmItem?.danger ? (
              <div style={{ color: 'var(--error-8)', fontWeight: 500 }}>
                ⚠ 此操作不可恢复,请确认没有正在进行的任务/会话依赖这些数据。
              </div>
            ) : (
              <div>该操作可安全执行,不影响业务数据。</div>
            )}
          </>
        }
        onConfirm={doClear}
        onCancel={() => setConfirmItem(null)}
      />
    </div>
  );
}
