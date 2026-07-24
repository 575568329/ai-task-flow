// frontend/src/components/board/RepoPathPicker.tsx
// 全局共享的仓库路径选择器:标准 Radix Select 下拉 + 「浏览选择…」哨兵项。
// - 下拉项 = 已有任务用过的 repoPath + 全局历史(localStorage),合并去重
// - 选「浏览选择…」→ 调系统原生文件夹选择器(原生能力,不自己模拟)
// - 确认的合法路径写入全局历史,其它入口立即可用
// 复用 ui/select(与执行环境等 Select 交互一致),不自建输入框。
import { useEffect, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  /** 选中/浏览目录成功后的额外回调(如 TaskDrawer 据此回填 projectName) */
  onPicked?: (path: string) => void;
}

/** 「浏览选择…」哨兵值(合法路径不会以双下划线开头,无冲突) */
const BROWSE_SENTINEL = '__browse__';

export function RepoPathPicker({
  value,
  onChange,
  placeholder,
  onPicked,
}: RepoPathPickerProps) {
  const [history, setHistory] = useState<string[]>(() => loadRepoHistory());

  useEffect(
    () => subscribeRepoHistory(() => setHistory(loadRepoHistory())),
    [],
  );

  // 已有任务用过的 repoPath(运行时从 store 取;与全局历史合并,
  // 无需手动积累即可在下拉里选到「已经有的项目路径」)
  const tasks = useTaskStore((s) => s.tasks);
  const taskRepoPaths = useMemo(
    () => tasks.map((t) => t.repoPath).filter((p): p is string => !!p),
    [tasks],
  );

  // 选项 = 当前值 + 已有任务路径 + 全局历史(合并去重,过滤脏数据)
  const options = useMemo(() => {
    const merged = [value, ...taskRepoPaths, ...history];
    return Array.from(new Set(merged.filter((p) => VALID_REPO_PATH.test(p))));
  }, [value, taskRepoPaths, history]);

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

  const handleSelect = (v: string) => {
    if (v === BROWSE_SENTINEL) {
      void onBrowse();
      return;
    }
    onChange(v);
    onPicked?.(v); // 选已有路径也触发,便于上层回填 projectName
  };

  return (
    <Select value={value || undefined} onValueChange={handleSelect}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder ?? '选择或浏览项目路径'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p} value={p}>
            <span className="truncate">{p}</span>
          </SelectItem>
        ))}
        <SelectItem value={BROWSE_SENTINEL}>
          <span className="flex items-center gap-1">
            <FolderOpen className="size-3.5" />
            浏览选择…
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
