// frontend/src/components/board/RepoPathPicker.tsx
// 全局共享的仓库路径选择器:可手输 / 从历史建议选 / 浏览系统目录。
// - 历史建议用 HTML 原生 <datalist>(原生能力,聚焦即见,无需自建下拉)
// - 浏览调用系统原生文件夹选择器(原生能力,不自己模拟)
// - 确认的合法路径写入全局历史(localStorage),其它入口立即可用
import { useEffect, useId, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { systemApi } from '@/api/task';
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

  // datalist 建议不含当前值(避免重复项)
  const suggestions = history.filter((p) => p !== value);

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
