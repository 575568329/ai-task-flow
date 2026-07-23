// frontend/src/components/board/BoardToolbar.tsx
// 看板顶部工具栏:连接状态 / 项目筛选 / 来源筛选 / 搜索 / 分组折叠快捷 + 新建任务。
import { useEffect, useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Plus, Search, Terminal } from 'lucide-react';
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
import { OpenClaudeDialog } from './OpenClaudeDialog';
import {
  loadShortcuts,
  eventToCombo,
  isSingleKey,
  isTypingTarget,
  isCapturing,
  formatCombo,
  type ShortcutMap,
} from '@/lib/shortcuts';

export function BoardToolbar() {
  const tasks = useTaskStore((s) => s.tasks);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const sourceFilter = useUIStore((s) => s.sourceFilter);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setProjectFilter = useUIStore((s) => s.setProjectFilter);
  const setSourceFilter = useUIStore((s) => s.setSourceFilter);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const setCreatingTask = useUIStore((s) => s.setCreatingTask);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const creatingTask = useUIStore((s) => s.creatingTask);

  // 快捷键配置(设置面板改动后通过 'shortcuts-changed' 事件重载)
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => loadShortcuts());
  useEffect(() => {
    const reload = () => setShortcuts(loadShortcuts());
    window.addEventListener('shortcuts-changed', reload);
    return () => window.removeEventListener('shortcuts-changed', reload);
  }, []);
  const collapseAllGroups = useUIStore((s) => s.collapseAllGroups);
  const expandAllGroups = useUIStore((s) => s.expandAllGroups);

  // SSE 连接状态:绿点=已连接 / 灰点=断开(订阅 sseClient,onopen/onerror 自动更新)
  const [sseConnected, setSseConnected] = useState(false);
  useEffect(() => sseClient.onStatusChange(setSseConnected), []);

  // 全局快捷键(配置可改):newTask=新建,openTerminal=打开终端(抽屉未开时走看板级)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isCapturing()) return; // 设置面板捕获重绑时暂停业务监听
      const combo = eventToCombo(e);
      if (!combo) return;
      // 单键快捷键在输入框中跳过;带修饰(如 Ctrl+S)不跳过
      if (isSingleKey(combo) && isTypingTarget(e.target as HTMLElement)) return;
      if (combo === shortcuts.newTask) {
        e.preventDefault();
        setCreatingTask(true);
      } else if (combo === shortcuts.openTerminal && selectedTaskId === null && !creatingTask) {
        e.preventDefault();
        setOpenClaude(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, setCreatingTask, selectedTaskId, creatingTask]);

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

  // 看板级「打开终端」:可选项目路径 = 已有任务的 repoPath 去重
  const repoPaths = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.repoPath).filter(Boolean))) as string[],
    [tasks],
  );
  const [openClaude, setOpenClaude] = useState(false);

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

      {/* 分组折叠快捷:展开全部 / 收起全部(列内按项目分组时用)。图标+文字组合,避免单独图标太突兀 */}
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-8 gap-1.5 px-2"
        title="展开全部分组"
        onClick={() => expandAllGroups()}
      >
        <ChevronsUpDown className="size-4" />
        展开分组
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground h-8 gap-1.5 px-2"
        title="折叠全部分组"
        onClick={() => collapseAllGroups(allGroupKeys)}
      >
        <ChevronsDownUp className="size-4" />
        收起分组
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpenClaude(true)}
          title={`打开终端 (${formatCombo(shortcuts.openTerminal)})`}
        >
          <Terminal className="size-4" />
          打开终端
        </Button>
        <Button
          size="sm"
          onClick={() => setCreatingTask(true)}
          title={`新建任务 (${formatCombo(shortcuts.newTask)})`}
        >
          <Plus className="size-4" />
          新建任务
        </Button>
      </div>

      {/* 看板级打开终端:选项目路径(已有或自选)→ 新建/恢复 Claude 会话 */}
      <OpenClaudeDialog
        open={openClaude}
        onOpenChange={setOpenClaude}
        env="cmd"
        projectOptions={repoPaths}
        allowPickRepo
      />
    </div>
  );
}
