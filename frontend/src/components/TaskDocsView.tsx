// frontend/src/components/TaskDocsView.tsx
import React, { useEffect, useState } from 'react';
import { FileText, Search, Loader2, FolderOpen, FileBox, Plus, X, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import type { TaskDTO } from '@ai-task-flow/shared';
import { taskApi, systemApi } from '../api/task';
import { readFile } from '../api/files';
import { MessageContent } from './chat/MessageContent';
import { FileTree } from './FileTree';
import { toast } from './ui/Toaster';
import { ConfirmDialog } from './ui/ConfirmDialog';
import './TaskDocsView.css';

type Mode = 'tasks' | 'files';

const ROOTS_KEY = 'ai-task-flow-doc-roots';

function loadRoots(): string[] {
  try {
    const raw = localStorage.getItem(ROOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRoots(roots: string[]) {
  localStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
}

const COLLAPSE_KEY = 'ai-task-flow-doc-roots-collapsed';

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollapsed(list: string[]) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
}

/**
 * 文档中心:两个来源的 Markdown 只读预览
 * - 任务文档:系统里的任务(后端 buildTaskMarkdown 生成)
 * - 项目文件:可挂载多个项目文件夹,文件树浏览其中的 .md,手动刷新捕获新增/改动
 * 右侧 Markdown 预览两态共享。
 */
export const TaskDocsView: React.FC = () => {
  const [mode, setMode] = useState<Mode>('tasks');

  // 任务文档
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 项目文件:多 root
  const [roots, setRoots] = useState<string[]>(() => loadRoots());
  const [refreshSignals, setRefreshSignals] = useState<Record<string, number>>({});
  const [activeRoot, setActiveRoot] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  // 折叠的项目(收起后只显示一行标题,节省空间)
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(() => new Set(loadCollapsed()));
  // 待确认移除的项目(× 点击不直接删,弹确认框)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // 共享预览
  const [markdown, setMarkdown] = useState('');
  const [loadingMd, setLoadingMd] = useState(false);
  const [error, setError] = useState('');

  // 拉任务列表
  useEffect(() => {
    taskApi
      .getAll()
      .then((list) => {
        setTasks(list);
        if (list.length > 0 && !selectedTaskId) setSelectedTaskId(list[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载任务列表失败'))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选任务 → 拉 md
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
    const next = roots.filter((r) => r !== root);
    setRoots(next);
    saveRoots(next);
    // 同步清理折叠态
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
    } catch (e: any) {
      setError(e.message || '读取文件失败');
      setMarkdown('');
    } finally {
      setLoadingMd(false);
    }
  };

  // 右侧是否需要显示"未选"空态
  const previewEmpty =
    (mode === 'tasks' && !selectedTaskId) ||
    (mode === 'files' && !selectedFilePath);

  return (
    <div className="sp-docs-layout">
      {/* 左栏 */}
      <aside className="sp-docs-list">
        {/* Tab 切换 */}
        <div className="sp-docs-tabs">
          <button
            className={`sp-docs-tab ${mode === 'tasks' ? 'active' : ''}`}
            onClick={() => setMode('tasks')}
          >
            <FileText size={15} /> 任务文档
          </button>
          <button
            className={`sp-docs-tab ${mode === 'files' ? 'active' : ''}`}
            onClick={() => setMode('files')}
          >
            <FolderOpen size={15} /> 项目文件
          </button>
        </div>

        {mode === 'tasks' ? (
          <>
            <div className="sp-docs-search">
              <Search size={15} className="sp-docs-search-icon" />
              <input
                className="sp-docs-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索任务标题 / ID"
              />
            </div>
            <div className="sp-docs-items">
              {loadingList ? (
                <div className="sp-docs-empty">加载中…</div>
              ) : filtered.length === 0 ? (
                <div className="sp-docs-empty">暂无任务</div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    className={`sp-docs-item ${selectedTaskId === t.id ? 'active' : ''}`}
                    onClick={() => setSelectedTaskId(t.id)}
                  >
                    <div className="sp-docs-item-title">{t.title || '（无标题）'}</div>
                    <div className="sp-docs-item-meta">
                      <span className={`sp-docs-status sp-docs-status--${t.status}`}>{t.status}</span>
                      <span className="sp-docs-item-id">{t.id.slice(0, 8)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="sp-docs-files-head">
              <button className="sp-docs-pick-btn" onClick={handleAddFolder}>
                <Plus size={15} /> 添加项目文件夹
              </button>
            </div>
            <div className="sp-docs-items">
              {roots.length === 0 ? (
                <div className="sp-docs-empty">
                  <FileBox size={32} strokeWidth={1.5} />
                  <p>添加一个项目文件夹后<br />在此浏览 .md 文件</p>
                </div>
              ) : (
                roots.map((root) => {
                  const collapsed = collapsedRoots.has(root);
                  return (
                    <div key={root} className="sp-docs-root-block">
                      <div className="sp-docs-root-head">
                        <button
                          className="sp-docs-root-toggle"
                          title={collapsed ? '展开' : '收起'}
                          onClick={() => handleToggleCollapse(root)}
                        >
                          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <FolderOpen size={14} className="sp-docs-root-ico" />
                        <span className="sp-docs-root-name" title={root}>{root}</span>
                        <button
                          className="sp-docs-root-refresh"
                          title="刷新(捕获新增/改动)"
                          onClick={() => handleRefreshRoot(root)}
                        >
                          <RefreshCw size={13} />
                        </button>
                        <button
                          className="sp-docs-root-close"
                          title="移除该项目"
                          onClick={() => setPendingRemove(root)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {!collapsed && (
                        <FileTree
                          root={root}
                          selectedPath={activeRoot === root ? selectedFilePath : undefined}
                          onSelectFile={(path) => handleSelectFile(root, path)}
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
      </aside>

      {/* 右栏:Markdown 预览(共享) */}
      <main className="sp-docs-preview">
        {previewEmpty ? (
          <div className="sp-docs-preview-empty">
            {mode === 'files' && roots.length === 0 ? (
              <FolderOpen size={48} strokeWidth={1.5} />
            ) : (
              <FileText size={48} strokeWidth={1.5} />
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
          <div className="sp-docs-preview-error">
            <p>{error}</p>
          </div>
        ) : loadingMd ? (
          <div className="sp-docs-preview-loading">
            <Loader2 size={24} className="sp-spin" />
            <span>加载文档中…</span>
          </div>
        ) : (
          <div className="sp-docs-md-wrap">
            <MessageContent content={markdown} sources={[]} />
          </div>
        )}
      </main>

      {/* 移除项目二次确认 */}
      <ConfirmDialog
        open={pendingRemove !== null}
        title="移除项目"
        danger
        confirmText="移除"
        message={
          <>
            确定移除项目吗？
            <div style={{ marginTop: 6, color: 'var(--text-1)', wordBreak: 'break-all' }}>
              {pendingRemove}
            </div>
            <div style={{ marginTop: 6 }}>仅从列表移除，不会删除磁盘上的任何文件。</div>
          </>
        }
        onConfirm={() => {
          if (pendingRemove) handleRemoveRoot(pendingRemove);
          setPendingRemove(null);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
};
