// frontend/src/components/floating/SessionList.tsx
// 悬浮窗左侧常驻对话列表:当前项目的所有会话(由父组件按 lastActiveAt 倒序传入)。
// 每项:来源色标(Win/WSL)+ 标题 + 关联任务 + 时间 + 条数;当前会话高亮;点击切换。
// 顶部「+ 新建对话」。来源色标补齐问题①(历史项无 Win/WSL 标签),常驻列表解决②(多对话不直观)。
import { Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectSessionSummary } from '@ai-task-flow/shared';

interface SessionListProps {
  sessions: ProjectSessionSummary[];
  activeSessionId?: string;
  loading?: boolean;
  onRefresh: () => void;
  onSelect: (sessionId: string, source: 'windows' | 'wsl') => void;
  onNew: (side: 'windows' | 'wsl') => void;
}

/** 来源色标:语义 token,不硬编码颜色。Win 灰、WSL 主色调,呼应顶栏 side 切换观感 */
function SourceBadge({ source }: { source?: 'windows' | 'wsl' }) {
  const isWsl = source === 'wsl';
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[9px] font-medium leading-[1.4]',
        isWsl ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
      )}
      title={
        isWsl
          ? 'WSL 侧会话(终端需用 WSL 的 claude --resume <id>)'
          : 'Windows 侧会话(终端需用 Windows 的 claude --resume <id>)'
      }
    >
      {isWsl ? 'WSL' : 'Win'}
    </span>
  );
}

export function SessionList({ sessions, activeSessionId, loading, onSelect, onNew, onRefresh }: SessionListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <span className="text-muted-foreground mr-auto text-xs font-medium">对话</span>
        {/* 新建对话:Win/WSL 是两套独立 claude session 池,新建时直接选侧。
            切换侧会清空进行中的对话,故只在「新建」入口暴露切换,避免对话中误触(步骤 4)。 */}
        {(['windows', 'wsl'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onNew(s)}
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] transition-colors',
              s === 'wsl'
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'bg-muted text-muted-foreground hover:bg-muted-foreground/12 hover:text-foreground',
            )}
            aria-label={`新建 ${s === 'wsl' ? 'WSL' : 'Windows'} 侧对话`}
            title={`新建 ${s === 'wsl' ? 'WSL' : 'Windows'} 侧对话`}
          >
            <Plus className="size-3" />
            {s === 'wsl' ? 'WSL' : 'Win'}
          </button>
        ))}
        {/* 刷新:复用 loadProjects 拉取本项目最新历史会话列表 */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="刷新对话列表"
          title="刷新对话列表"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="text-muted-foreground p-3 text-center text-xs">加载中…</div>
        ) : sessions.length === 0 ? (
          <div className="text-muted-foreground p-3 text-center text-xs">暂无历史会话</div>
        ) : (
          sessions.map((s) => {
            const isActive = s.sessionId === activeSessionId;
            return (
              <button
                key={s.sessionId}
                type="button"
                data-active={isActive ? 'true' : undefined}
                onClick={() => onSelect(s.sessionId, s.source ?? 'windows')}
                className={cn(
                  'hover:bg-accent mb-0.5 flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left',
                  isActive && 'bg-accent',
                )}
              >
                <div className="flex w-full items-center gap-1">
                  <SourceBadge source={s.source} />
                  <span className="truncate text-xs font-medium">{s.title || '(无标题)'}</span>
                </div>
                <div className="text-muted-foreground flex w-full items-center gap-1 text-[10px]">
                  {s.taskTitle && (
                    <span className="bg-muted max-w-[50%] truncate rounded px-1">{s.taskTitle}</span>
                  )}
                  <span>· {new Date(s.lastActiveAt).toLocaleDateString()}</span>
                  <span>· {s.messageCount}条</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
