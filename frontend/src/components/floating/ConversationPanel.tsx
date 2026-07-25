// frontend/src/components/floating/ConversationPanel.tsx
// 项目对话视图(悬浮窗对话态):顶栏(返回 + 对话名/关联任务/会话ID)+ 消息流 + 输入框。
// 消息流复用 MessageStream(与 TaskConversation 共用),数据源为 projectChatStore.current。
// 与 TaskConversation 区别:不绑 taskId,对话以 repoPath(项目 cwd)为根,自由对话不注入任务上下文。
import { useMemo, useState } from 'react';
import { ArrowUp, Square, ArrowLeft, Copy, History } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MessageStream } from '@/components/chat/MessageStream';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

export function ConversationPanel() {
  const current = useProjectChatStore((s) => s.current);
  const send = useProjectChatStore((s) => s.send);
  const stop = useProjectChatStore((s) => s.stop);
  const setSide = useProjectChatStore((s) => s.setSide);
  const backToList = useProjectChatStore((s) => s.backToList);
  const openSession = useProjectChatStore((s) => s.openSession);
  const projects = useProjectChatStore((s) => s.projects);
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  // 当前项目的会话列表(历史 Popover 用);projects 未加载时为空
  const repoSessions = useMemo(
    () => projects.find((p) => p.repoPath === current?.repoPath)?.sessions ?? [],
    [projects, current?.repoPath],
  );

  // 列表视图时 current 为 null,但本组件仅在对话视图渲染;guard 兜底
  if (!current) return null;

  const { turns, streaming, error, usage, side, sessionId, title, taskTitle, repoPath } = current;

  const onSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    void send(text);
  };

  const onCopyLast = async () => {
    // 复制最后一条 assistant 的纯文本(footer 复制按钮)
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.role === 'assistant' && t.blocks) {
        const text = t.blocks
          .filter((b) => b.kind === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n');
        if (text) {
          await navigator.clipboard.writeText(text);
          return;
        }
      }
    }
  };

  // 复制当前会话的终端恢复指令(方便在终端 claude --resume <id> 接着聊)
  const onCopySessionId = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(`claude --resume ${sessionId}`);
      toast.success('已复制恢复指令');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏:返回 + 对话标题(对话名 · 关联任务 · 会话ID)+ 侧切换 */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={backToList}
          disabled={streaming}
          className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-6 items-center justify-center rounded disabled:opacity-40"
          aria-label="返回对话列表"
          title="返回对话列表"
        >
          <ArrowLeft className="size-4" />
        </button>
        {/* 历史会话:在当前项目内快速切换,无需返回列表(与 TaskConversation 历史面板一致) */}
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={streaming}
              className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-6 items-center justify-center rounded disabled:opacity-40"
              aria-label="历史会话"
              title="历史会话"
            >
              <History className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="max-h-[60vh] w-72 overflow-y-auto p-1">
            {repoSessions.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-xs">该项目暂无历史会话</div>
            ) : (
              repoSessions.map((s) => {
                const isActive = s.sessionId === sessionId;
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => {
                      void openSession(repoPath, s.sessionId, s.source ?? side, {
                        title: s.title,
                        taskTitle: s.taskTitle,
                      });
                      setHistoryOpen(false);
                    }}
                    className={cn(
                      'hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left',
                      isActive && 'bg-accent',
                    )}
                  >
                    <div className="flex w-full items-center gap-1">
                      <span className="truncate text-xs font-medium">{s.title || '(无标题)'}</span>
                      {isActive && <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                    </div>
                    <div className="text-muted-foreground flex w-full items-center gap-1 text-[10px]">
                      {s.taskTitle && (
                        <span className="bg-muted max-w-[50%] truncate rounded px-1">{s.taskTitle}</span>
                      )}
                      <span>· {new Date(s.lastActiveAt).toLocaleString()}</span>
                      <span>· {s.messageCount} 条</span>
                    </div>
                  </button>
                );
              })
            )}
          </PopoverContent>
        </Popover>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{title || '(新对话)'}</div>
          <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
            {taskTitle && (
              <span className="bg-muted truncate rounded px-1" title={`关联任务:${taskTitle}`}>
                任务:{taskTitle}
              </span>
            )}
            {sessionId && (
              <button
                type="button"
                onClick={onCopySessionId}
                className="hover:text-foreground inline-flex items-center gap-0.5 font-mono transition-colors"
                title={`会话 ID:${sessionId}\n点击复制恢复指令`}
              >
                <span>{sessionId.slice(0, 8)}</span>
                <Copy className="size-2.5" />
              </button>
            )}
          </div>
        </div>
        {/* 侧切换:Windows / WSL claude(两套独立 session 池) */}
        <div className="bg-muted inline-flex shrink-0 rounded-md p-0.5">
          {(['windows', 'wsl'] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={streaming}
              onClick={() => setSide(s)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50',
                side === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
              title={s === 'wsl' ? '用 WSL 里的 claude' : '用 Windows 的 claude'}
            >
              {s === 'wsl' ? 'WSL' : 'Win'}
            </button>
          ))}
        </div>
      </div>

      {/* 消息流(渲染复用 MessageStream) */}
      <MessageStream
        turns={turns}
        streaming={streaming}
        error={error}
        usage={usage}
        onCopyLast={onCopyLast}
        emptyHint={
          <div className="text-muted-foreground py-8 text-center text-sm">
            输入消息开始对话。工作目录:
            <span className="block font-mono text-[11px]">{repoPath}</span>
          </div>
        }
      />

      {/* 输入框 */}
      <div className="border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送 / Shift+Enter 换行(与 TaskConversation 一致)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={streaming ? 'Claude 正在回复…(可点停止)' : '输入消息(Enter 发送,Shift+Enter 换行)'}
          disabled={streaming}
          disableAutoGrow
          className="min-h-16 max-h-32 resize-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-muted-foreground/60 text-[11px]">
            {usage
              ? `· 输入 ${usage.input_tokens.toLocaleString()} / 输出 ${usage.output_tokens.toLocaleString()}`
              : ''}
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="bg-destructive hover:bg-destructive/90 inline-flex size-8 items-center justify-center rounded-full text-white transition-colors"
              title="停止"
              aria-label="停止"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!input.trim()}
              className="bg-primary hover:bg-primary/90 inline-flex size-8 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              title="发送 (Enter)"
              aria-label="发送"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
