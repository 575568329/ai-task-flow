// frontend/src/components/board/RepoPathPicker.tsx
// 全局共享的仓库路径选择器:可手输 / 从历史建议选 / 浏览系统目录。
// - 历史建议用 HTML 原生 <datalist>(原生能力,聚焦即见,无需自建下拉)
// - 浏览调用系统原生文件夹选择器(原生能力,不自己模拟)
// - 确认的合法路径写入全局历史(localStorage),其它入口立即可用
import { useEffect, useId, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { systemApi } from '@/api/task';
import { useTaskStore } from '@/stores/taskStore';
import { toast } from '@/components/ui/toaster';
import {
  loadRepoHistory,
  addRepoHistory,
  subscribeRepoHistory,
  VALID_REPO_PATH,
} from '@/lib/repoHistory';

interface RepoPathPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  /** 浏览/选中目录成功后的额外回调(如 TaskDrawer 据此回填 projectName) */
  onPicked?: (path: string) => void;
}

export function RepoPathPicker({
  value,
  onChange,
  placeholder,
  onPicked,
}: RepoPathPickerProps) {
  const listId = useId();
  const [history, setHistory] = useState<string[]>(() => loadRepoHistory());

  useEffect(
    () => subscribeRepoHistory(() => setHistory(loadRepoHistory())),
    [],
  );

  // 已有任务用过的 repoPath(运行时从 store 取;与全局历史合并,
  // 无需手动积累即可在 datalist 里选到「已经有的项目路径」)
  const tasks = useTaskStore((s) => s.tasks);
  const taskRepoPaths = useMemo(
    () => tasks.map((t) => t.repoPath).filter((p): p is string => !!p),
    [tasks],
  );

  // 建议项 = 全局历史 + 已有任务 repoPath(合并去重,过滤脏数据与当前值)
  const suggestions = useMemo(() => {
    const merged = [...history, ...taskRepoPaths];
    return Array.from(new Set(merged.filter((p) => VALID_REPO_PATH.test(p) && p !== value)));
  }, [history, taskRepoPaths, value]);

  const onBrowse = async () => {
    try {
      const { path } = await systemApi.selectDirectory();
      if (!path) return;
      addRepoHistory(path);
      onChange(path);
      onPicked?.(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选择目录失败');
    }
  };

  // 失焦时若值是合法绝对路径,顺手写入历史(手输的新路径也进历史)
  const onBlur = () => {
    const v = value.trim();
    if (v && VALID_REPO_PATH.test(v)) addRepoHistory(v);
  };

  return (
    <div className="flex gap-2">
      <Input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder ?? '/path/to/repo'}
      />
      <datalist id={listId}>
        {suggestions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <Button
        variant="outline"
        size="icon"
        onClick={() => void onBrowse()}
        aria-label="选择目录"
        title="选择目录"
      >
        <FolderOpen className="size-4" />
      </Button>
    </div>
  );
}
