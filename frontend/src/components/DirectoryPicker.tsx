// frontend/src/components/DirectoryPicker.tsx
// 本地目录选择器:用于挑选项目根路径(浏览器拿不到原生路径,所以走后端代理)
//
// 交互:
// - 顶部:当前路径展示 + ↑上级 + 快捷入口(主目录、桌面、驱动器)
// - 中部:子目录列表,git 仓库标识,双击进入
// - 底部:取消 / 选中此处

import { useEffect, useState } from 'react';
import { ChevronUp, Folder, FolderGit2, Home, Monitor, HardDrive, Loader2 } from 'lucide-react';
import type { BrowseDirResponse } from '@ai-task-flow/shared';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { toast } from './ui/Toaster';

interface DirectoryPickerProps {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function DirectoryPicker({ open, initialPath, onClose, onSelect }: DirectoryPickerProps) {
  const [data, setData] = useState<BrowseDirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<string | undefined>(initialPath);

  // 打开时重置 target;关闭时清空数据避免下次闪一下旧内容
  useEffect(() => {
    if (open) setTarget(initialPath);
    else setData(null);
  }, [open, initialPath]);

  // target 变化时拉数据(target undefined 时后端默认 home)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const url = target
      ? `/api/projects/browse?path=${encodeURIComponent(target)}`
      : '/api/projects/browse';
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        return res.json() as Promise<BrowseDirResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // 保持 target 与服务端规范化后的 path 同步(path.normalize)
        setTarget(d.path);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`无法访问: ${err.message}`);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [target, open]);

  // 选中当前路径并关闭
  function confirmSelect() {
    if (!data) return;
    onSelect(data.path);
    onClose();
  }

  const isWin = (data?.drives?.length ?? 0) > 0;
  // 桌面路径(简单拼接,Mac/Linux 也通用)
  const desktopPath = data ? joinPath(data.home, 'Desktop', isWin) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="选择项目目录"
      width={680}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!data} onClick={confirmSelect}>
            选中此处
          </Button>
        </>
      }
    >
      {/* 当前路径条 */}
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => data?.parent && setTarget(data.parent)}
          disabled={!data?.parent}
          className="rounded p-1.5 disabled:opacity-30"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
          title="上级目录"
        >
          <ChevronUp size={16} />
        </button>
        <div
          className="flex-1 truncate rounded px-2.5 py-1.5 font-mono text-xs"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-1)' }}
          title={data?.path}
        >
          {data?.path ?? '加载中…'}
        </div>
        {data?.isGitRepo && (
          <span
            className="rounded px-2 py-0.5 text-xs"
            style={{ backgroundColor: 'var(--success-2)', color: 'var(--success-9)' }}
          >
            git 仓库
          </span>
        )}
      </div>

      {/* 快捷入口 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <ShortcutButton icon={<Home size={13} />} label="主目录" onClick={() => data && setTarget(data.home)} />
        {desktopPath && (
          <ShortcutButton icon={<Monitor size={13} />} label="桌面" onClick={() => setTarget(desktopPath)} />
        )}
        {data?.drives?.map((drive) => (
          <ShortcutButton
            key={drive}
            icon={<HardDrive size={13} />}
            label={drive}
            onClick={() => setTarget(drive)}
          />
        ))}
      </div>

      {/* 子目录列表 */}
      <div
        className="max-h-[50vh] min-h-[280px] overflow-y-auto rounded border"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-1)' }}
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 p-6 text-sm" style={{ color: 'var(--text-3)' }}>
            <Loader2 size={16} className="animate-spin" />
            加载中…
          </div>
        )}
        {!loading && data && data.entries.length === 0 && (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
            （此目录下没有可选子目录）
          </div>
        )}
        {!loading &&
          data?.entries.map((entry) => {
            const childPath = joinPath(data.path, entry.name, isWin);
            return (
              <button
                key={entry.name}
                onDoubleClick={() => setTarget(childPath)}
                onClick={() => setTarget(childPath)}
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm transition-fast hover:opacity-80"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-1)' }}
                title="点击进入"
              >
                {entry.isGitRepo ? (
                  <FolderGit2 size={15} style={{ color: 'var(--primary-7)' }} />
                ) : (
                  <Folder size={15} style={{ color: 'var(--text-3)' }} />
                )}
                <span className="flex-1">{entry.name}</span>
                {entry.isGitRepo && (
                  <span className="text-xs" style={{ color: 'var(--primary-7)' }}>
                    git
                  </span>
                )}
              </button>
            );
          })}
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
        提示:点击文件夹进入下级,点「选中此处」选定当前显示路径作为项目根。
      </p>
    </Modal>
  );
}

function ShortcutButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-fast hover:opacity-80"
      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
    >
      {icon}
      {label}
    </button>
  );
}

/** 跨平台拼接路径(避免引入 path 库到前端) */
function joinPath(base: string, child: string, isWin: boolean): string {
  const sep = isWin ? '\\' : '/';
  if (base.endsWith(sep) || base.endsWith('/')) return base + child;
  return base + sep + child;
}
