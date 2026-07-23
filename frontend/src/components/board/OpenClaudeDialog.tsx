// frontend/src/components/board/OpenClaudeDialog.tsx
// "打开终端"弹窗:在指定项目目录下新建或恢复 Claude Code 会话。
// - 新建:启动终端开新会话(无 sessionId),复制 claude 命令到剪贴板
// - 恢复:列表来自 ~/.claude/projects 历史会话;选中后 --resume 继续
//
// 两种用法:
//   1. 任务级(TaskDrawer):传入 repoPath → 固定路径,隐藏路径选择器
//   2. 看板级(BoardToolbar):不传 repoPath,传 projectOptions + allowPickRepo
//      → 显示「项目路径」选择器(下拉已有项目 + 浏览自选)
//
// 布局:DialogContent = flex flex-col max-h;标题(DialogHeader)/按钮(DialogFooter)
// shrink-0 固定,只有「历史会话列表」区 flex-1 overflow-y-auto 滚动,避免长内容把标题/按钮滚没。
//
// 为什么不用 RadioGroup:项目未安装 @radix-ui/react-radio-group,前端装包是 Windows 专属
// (见 memory),不为此新增依赖。改用可点击列表项 + selected-state 样式实现单选语义。
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RotateCcw, Terminal, FolderOpen } from 'lucide-react';
import type { TaskEnv, ClaudeSessionMeta } from '@ai-task-flow/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { systemApi } from '@/api/task';
import { relativeTime } from '@/lib/taskMeta';
import { cn } from '@/lib/utils';

interface OpenClaudeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 任务级固定路径(传入则隐藏路径选择器,直接用此路径) */
  repoPath?: string;
  env: TaskEnv;
  /** 看板级:可选项目路径列表(下拉项) */
  projectOptions?: string[];
  /** 看板级:允许选择/自选路径(repoPath 未传时显示路径选择器) */
  allowPickRepo?: boolean;
}

export function OpenClaudeDialog({
  open,
  onOpenChange,
  repoPath,
  env,
  projectOptions,
  allowPickRepo,
}: OpenClaudeDialogProps) {
  // 任务级:传了 repoPath 视为固定,不显示路径选择器
  const fixedRepo = !!repoPath;
  // 看板级:用户选择/自选的路径
  const [selectedRepo, setSelectedRepo] = useState('');

  const effectiveRepo = fixedRepo ? (repoPath as string) : selectedRepo;

  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 执行环境:默认取任务 env,弹窗内可改(cmd/wsl/pwsh)覆盖任务级默认;
  // 同时作为历史会话列表的过滤维度——切 wsl 只看 WSL 侧会话,切 cmd/pwsh 只看 Windows 侧
  const [selectedEnv, setSelectedEnv] = useState<TaskEnv>(env);
  useEffect(() => {
    setSelectedEnv(env);
  }, [env]);

  // 弹窗重新打开时,看板级重置已选路径(任务级用传入 repoPath)
  useEffect(() => {
    if (open) {
      setSelectedRepo('');
      setSelectedId(null);
    }
  }, [open]);

  // 按 selectedEnv 过滤会话:wsl↔Windows 两个 home 来源(cmd/pwsh 同属 Windows home)
  const filteredSessions = useMemo(
    () =>
      sessions.filter((s) =>
        selectedEnv === 'wsl' ? s.source === 'wsl' : s.source !== 'wsl',
      ),
    [sessions, selectedEnv],
  );

  // 切换环境后,若当前选中不在过滤后的列表里,重置到首项
  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!filteredSessions.some((s) => s.sessionId === selectedId)) {
      setSelectedId(filteredSessions[0].sessionId);
    }
  }, [filteredSessions, selectedId]);

  // 打开时拉取历史会话(失败静默:该项目可能从无历史)
  useEffect(() => {
    if (!open || !effectiveRepo) return;
    let cancelled = false;
    setLoading(true);
    systemApi
      .listClaudeSessions(effectiveRepo)
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        // 默认选中第一项;无则 null
        setSelectedId(res.sessions[0]?.sessionId ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, effectiveRepo]);

  // 看板级:浏览自选项目目录
  const onPickDir = async () => {
    try {
      const { path } = await systemApi.selectDirectory();
      if (path) setSelectedRepo(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选择目录失败');
    }
  };

  // fire-and-forget:不阻塞 UI,用户可连续点开多个终端窗口;成功/失败由 toast 异步反馈
  const openNew = () => {
    if (!effectiveRepo) {
      toast.error('请先选择项目路径');
      return;
    }
    systemApi
      .openClaudeSession({ repoPath: effectiveRepo, env: selectedEnv })
      .then(({ claudeCommand }) => {
        // 把命令复制到剪贴板便于用户核对/手动粘贴
        navigator.clipboard.writeText(claudeCommand).catch(() => {});
        toast.success('已打开新会话窗口');
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '打开失败');
      });
  };

  // fire-and-forget:同上,不阻塞 UI。闭包捕获 sessionId,避免请求进行中改选用错 id
  const resumeSelected = () => {
    if (!selectedId) return;
    if (!effectiveRepo) {
      toast.error('请先选择项目路径');
      return;
    }
    const sessionId = selectedId;
    systemApi
      .openClaudeSession({ repoPath: effectiveRepo, env: selectedEnv, sessionId })
      .then(() => {
        toast.success('已恢复会话,可继续选择下一个');
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '恢复失败');
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="min-w-0">
          <DialogTitle>打开终端</DialogTitle>
          <DialogDescription>
            在 <span className="font-mono text-xs break-all">{effectiveRepo || '(未选择项目)'}</span> 下新建或恢复 Claude 会话
          </DialogDescription>
        </DialogHeader>

        {/* 中间区:flex-1 可收缩;项目路径/执行环境/新建会话/历史标题 shrink-0 固定,
            只有历史会话列表滚动 → 标题与底部按钮永不随内容滚走 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* 看板级:项目路径选择器(下拉已有项目 + 浏览自选) */}
          {!fixedRepo && allowPickRepo && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground w-16 shrink-0 text-xs font-medium">项目路径</span>
              <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="选择已有项目路径" />
                </SelectTrigger>
                <SelectContent>
                  {(projectOptions ?? []).map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="truncate">{p}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => void onPickDir()}
                aria-label="浏览选择目录"
                title="浏览选择目录"
              >
                <FolderOpen className="size-4" />
              </Button>
            </div>
          )}

          {/* 执行环境选择(覆盖任务默认 env;新建/恢复都用它) */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0 text-xs font-medium">执行环境</span>
            <Select value={selectedEnv} onValueChange={(value) => setSelectedEnv(value as TaskEnv)}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cmd">cmd (Windows)</SelectItem>
                <SelectItem value="wsl">wsl (Ubuntu)</SelectItem>
                <SelectItem value="pwsh">pwsh (PowerShell 7)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 新建会话 */}
          <Button variant="outline" className="shrink-0" onClick={openNew} disabled={!effectiveRepo}>
            <Plus className="size-4" />
            新建会话
          </Button>

          {/* 历史会话标题(按 selectedEnv 过滤:cmd/pwsh→Windows 侧,wsl→WSL 侧) */}
          <div className="text-muted-foreground shrink-0 text-xs font-medium">
            历史会话
            <span className="ml-2 font-normal">
              {selectedEnv === 'wsl' ? 'WSL 侧' : 'Windows 侧'}
            </span>
          </div>

          {/* 历史会话列表:唯一可滚动区(flex-1 + overflow-y-auto) */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            {!effectiveRepo ? (
              <div className="text-muted-foreground/50 rounded-md border border-dashed py-6 text-center text-xs">
                请先选择项目路径
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-muted-foreground/50 rounded-md border border-dashed py-6 text-center text-xs">
                暂无历史会话
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredSessions.map((s) => {
                  const active = s.sessionId === selectedId;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => setSelectedId(s.sessionId)}
                      className={cn(
                        'flex min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                        active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Terminal className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="flex-1 truncate text-sm font-medium">
                          {s.title || '(无标题)'}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1 py-0 text-[10px]',
                            s.source === 'wsl'
                              ? 'bg-amber-500/10 text-amber-600'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {s.source === 'wsl' ? 'WSL' : 'Win'}
                        </span>
                      </div>
                      <div className="text-muted-foreground pl-5 text-[10px]">
                        {s.messageCount} 条消息 · {relativeTime(s.lastActiveAt)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={resumeSelected} disabled={!selectedId || !effectiveRepo}>
            <RotateCcw className="size-4" />
            恢复会话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
