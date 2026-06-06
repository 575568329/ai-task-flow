// frontend/src/components/DiffViewer.tsx
import { useEffect, useState } from 'react';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { taskApi } from '@/api/task';

interface DiffViewerProps {
  taskId: string;
}

export function DiffViewer({ taskId }: DiffViewerProps) {
  const [diffText, setDiffText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // base 不传,后端默认 main;失败时提示(worktree 基线分支可能不同)
    taskApi
      .getDiff(taskId)
      .then((res) => {
        if (!cancelled) setDiffText(res.diff);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '获取 diff 失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-2)' }}>加载 diff…</p>;
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: 'var(--error-6)' }}>
        {error}
      </p>
    );
  }
  if (!diffText || !diffText.trim()) {
    return <p className="text-sm" style={{ color: 'var(--text-2)' }}>无变更</p>;
  }

  const files = parseDiff(diffText);

  return (
    <div className="overflow-x-auto rounded-lg border text-xs" style={{ borderColor: 'var(--border-primary)' }}>
      {files.map((file, i) => (
        <div key={i}>
          <div
            className="px-3 py-1.5 font-mono font-semibold"
            style={{ background: 'var(--fill-hover)' }}
          >
            {file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}
          </div>
          <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      ))}
    </div>
  );
}
