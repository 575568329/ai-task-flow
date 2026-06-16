// frontend/src/components/FileTree.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Loader2 } from 'lucide-react';
import { listFiles, type FileEntry } from '../api/files';
import './FileTree.css';

interface FileTreeProps {
  root: string;
  /** 选中某 md 文件时回调,传入相对 root 的 path */
  onSelectFile: (path: string, name: string) => void;
  selectedPath?: string;
  /** 刷新信号:变化时清空缓存重新加载已展开目录(捕获新增/改动),不改变展开状态 */
  refreshSignal?: number;
}

/**
 * 项目文件树(懒加载):点目录才请求下一层,只展示目录与 md 文件(后端已过滤)。
 * 刷新 = 清空 entriesMap(保留 expanded),已展开的目录会自动重新请求。
 */
export const FileTree: React.FC<FileTreeProps> = ({ root, onSelectFile, selectedPath, refreshSignal }) => {
  // entriesMap: dirPath -> 子项列表('' 表示根)
  const [entriesMap, setEntriesMap] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  // root 变化时重置并加载顶层
  useEffect(() => {
    setEntriesMap({});
    setExpanded(new Set());
    setError('');
    loadDir('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // refreshSignal 变化时清缓存重载(保留展开态),捕获文件新增/删除/改动
  useEffect(() => {
    if (refreshSignal === undefined) return;
    setEntriesMap({});
    setError('');
    // 重新加载根;已展开的子目录会在 renderLevel 时自动重新请求
    loadDir('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (entriesMap[dirPath]) return; // 已加载
      setLoading((s) => ({ ...s, [dirPath]: true }));
      try {
        const res = await listFiles(root, dirPath || undefined);
        setEntriesMap((s) => ({ ...s, [dirPath]: res.entries }));
      } catch (e: any) {
        setError(e.message || '加载目录失败');
      } finally {
        setLoading((s) => ({ ...s, [dirPath]: false }));
      }
    },
    [root, entriesMap],
  );

  const toggleDir = (dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
    loadDir(dirPath);
  };

  const renderLevel = (dirPath: string, depth: number): React.ReactNode => {
    const entries = entriesMap[dirPath];
    if (loading[dirPath] && !entries) {
      return (
        <div className="sp-ft-loading" style={{ paddingLeft: depth * 14 + 20 }}>
          <Loader2 size={13} className="sp-spin" /> 加载中…
        </div>
      );
    }
    if (!entries) return null;
    if (entries.length === 0) {
      return (
        <div className="sp-ft-empty" style={{ paddingLeft: depth * 14 + 20 }}>
          （空）
        </div>
      );
    }
    return entries.map((e) => {
      const isDir = e.type === 'dir';
      const isOpen = expanded.has(e.path);
      const isActive = selectedPath === e.path;
      return (
        <div key={e.path}>
          <button
            className={`sp-ft-node ${isActive ? 'active' : ''}`}
            style={{ paddingLeft: depth * 14 + 8 }}
            onClick={() => (isDir ? toggleDir(e.path) : onSelectFile(e.path, e.name))}
            title={e.name}
          >
            {isDir ? (
              <>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {isOpen ? <FolderOpen size={15} className="sp-ft-ico-dir" /> : <Folder size={15} className="sp-ft-ico-dir" />}
              </>
            ) : (
              <>
                <span className="sp-ft-chevron-ph" />
                <FileText size={15} className="sp-ft-ico-file" />
              </>
            )}
            <span className="sp-ft-name">{e.name}</span>
          </button>
          {isDir && isOpen && renderLevel(e.path, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="sp-file-tree">
      {error && <div className="sp-ft-error">{error}</div>}
      {renderLevel('', 0)}
    </div>
  );
};
