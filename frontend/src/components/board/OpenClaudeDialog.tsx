// frontend/src/components/board/OpenClaudeDialog.tsx
// "打开终端"弹窗:在指定项目目录下新建或恢复 Claude Code 会话。
// - 新建:启动终端开新会话(无 sessionId),复制 claude 命令到剪贴板
// - 恢复:列表来自 ~/.claude/projects 历史会话;选中后 --resume 继续
//
// 为什么不用 RadioGroup:项目未安装 @radix-ui/react-radio-group,前端装包是 Windows 专属
// (见 memory),不为此新增依赖。改用可点击列表项 + selected-state 样式实现单选语义。
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RotateCcw, Terminal } from 'lucide-react';
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
  repoPath: string;
  env: TaskEnv;
}

export function OpenClaudeDialog({
  open,
  onOpenChange,
  repoPath,
  env,
}: OpenClaudeDialogProps) {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 执行环境:默认取任务 env,弹窗内可改(cmd/wsl/pwsh)覆盖任务级默认;
  // 同时作为历史会话列表的过滤维度——切 wsl 只看 WSL 侧会话,切 cmd/pwsh 只看 Windows 侧
  const [selectedEnv, setSelectedEnv] = useState<TaskEnv>(env);
  useEffect(() => {
    setSelectedEnv(env);
  }, [env]);

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
    if (!open || !repoPath) return;
    let cancelled = false;
    setLoading(true);
    systemApi
      .listClaudeSessions(repoPath)
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
  }, [open, repoPath]);

  // fire-and-forget:不阻塞 UI,用户可连续点开多个终端窗口;成功/失败由 toast 异步反馈
  const openNew = () => {
    systemApi
      .openClaudeSession({ repoPath, env: selectedEnv })
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
    const sessionId = selectedId;
    systemApi
      .openClaudeSession({ repoPath, env: selectedEnv, sessionId })
      .then(() => {
        toast.success('已恢复会话,可继续选择下一个');
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '恢复失败');
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl sm:max-w-4xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>打开终端</DialogTitle>
          <DialogDescription>
            在 <span className="font-mono text-xs break-all">{repoPath}</span> 下新建或恢复 Claude 会话
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {/* 执行环境选择(覆盖任务默认 env;新建/恢复都用它) */}
          <div className="flex items-center gap-2">
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
          <Button variant="outline" onClick={openNew}>
            <Plus className="size-4" />
            新建会话
          </Button>

          {/* 历史会话列表(按 selectedEnv 过滤:cmd/pwsh→Windows 侧,wsl→WSL 侧) */}
          <div className="text-muted-foreground text-xs font-medium">
            历史会话
            <span className="ml-2 font-normal">
              {selectedEnv === 'wsl' ? 'WSL 侧' : 'Windows 侧'}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-muted-foreground/50 rounded-md border border-dashed py-6 text-center text-xs">
              暂无历史会话
            </div>
          ) : (
            <div className="flex max-h-64 min-w-0 flex-col gap-1 overflow-y-auto pr-1">
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={resumeSelected} disabled={!selectedId}>
            <RotateCcw className="size-4" />
            恢复会话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
