// frontend/src/components/board/BoardToolbar.tsx
// 看板顶部工具栏:连接状态 / 项目筛选 / 来源筛选 / 搜索 / 分组折叠快捷 + 新建任务。
import { useEffect, useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { sseClient } from '@/api/sse';
import { cn } from '@/lib/utils';
import { ALL_OPTION, UNGROUPED_KEY } from './meta';

export function BoardToolbar() {
  const tasks = useTaskStore((s) => s.tasks);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const sourceFilter = useUIStore((s) => s.sourceFilter);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setProjectFilter = useUIStore((s) => s.setProjectFilter);
  const setSourceFilter = useUIStore((s) => s.setSourceFilter);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const setCreatingTask = useUIStore((s) => s.setCreatingTask);
  const collapseAllGroups = useUIStore((s) => s.collapseAllGroups);
  const expandAllGroups = useUIStore((s) => s.expandAllGroups);

  // SSE 连接状态:绿点=已连接 / 灰点=断开(订阅 sseClient,onopen/onerror 自动更新)
  const [sseConnected, setSseConnected] = useState(false);
  useEffect(() => sseClient.onStatusChange(setSseConnected), []);

  const projects = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((t) => t.projectName).filter(Boolean))
      ) as string[],
    [tasks]
  );

  // 当前所有项目分组 key(含未分组哨兵),供「全部折叠」一键收起
  const allGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tasks) {
      keys.add(t.projectName?.trim() ? t.projectName : UNGROUPED_KEY);
    }
    return Array.from(keys);
  }, [tasks]);

  return (
    <div className="bg-background/80 flex items-center gap-2 border-b px-3 py-2 backdrop-blur">
      <div
        className="flex items-center gap-1.5 pr-1"
        title={sseConnected ? '实时推送已连接' : '实时推送断开,正在重连…'}
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full transition-colors',
            sseConnected ? 'bg-green-500' : 'bg-muted-foreground/40',
          )}
        />
        <span className="text-muted-foreground hidden text-xs sm:inline">
          {sseConnected ? '已连接' : '断开'}
        </span>
      </div>

      <Select
        value={projectFilter ?? ALL_OPTION}
        onValueChange={(value) => setProjectFilter(value === ALL_OPTION ? null : value)}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="项目" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_OPTION}>全部项目</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project} value={project}>
              {project}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sourceFilter ?? ALL_OPTION}
        onValueChange={(value) => setSourceFilter(value === ALL_OPTION ? null : value as 'web' | 'manual')}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="来源" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_OPTION}>全部来源</SelectItem>
          <SelectItem value="web">网页剪藏</SelectItem>
          <SelectItem value="manual">手动新建</SelectItem>
        </SelectContent>
      </Select>

      <div className="relative w-64">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索标题或描述…"
          className="h-8 pl-8"
        />
      </div>

      {/* 分组折叠快捷:展开全部 / 收起全部(列内按项目分组时用) */}
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-8 px-2"
        title="展开全部分组"
        onClick={() => expandAllGroups()}
      >
        <ChevronsUpDown className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-8 px-2"
        title="折叠全部分组"
        onClick={() => collapseAllGroups(allGroupKeys)}
      >
        <ChevronsDownUp className="size-4" />
      </Button>

      <Button size="sm" className="ml-auto" onClick={() => setCreatingTask(true)}>
        <Plus className="size-4" />
        新建任务
      </Button>
    </div>
  );
}
