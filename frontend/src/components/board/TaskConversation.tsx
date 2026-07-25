// frontend/src/components/board/TaskConversation.tsx
// 任务对话(任务详情内嵌用):消息流 + 输入框 + 历史会话 + sessionId 复制 + 重命名。
// 消息流渲染已抽到 MessageStream(与项目对话 ConversationPanel 共用),本组件只管任务绑定的数据源 + 输入/历史。
import { useEffect, useState } from 'react';
import { ArrowUp, Square, Copy, History, Pencil } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MessageStream } from '@/components/chat/MessageStream';
import { useTaskChatStore } from '@/stores/taskChatStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

interface TaskConversationProps {
  taskId: string;
}

export function TaskConversation({ taskId }: TaskConversationProps) {
  const chat = useTaskChatStore((s) => s.chats[taskId]);
  const send = useTaskChatStore((s) => s.send);
  const stop = useTaskChatStore((s) => s.stop);
  const setSide = useTaskChatStore((s) => s.setSide);
  const loadSessions = useTaskChatStore((s) => s.loadSessions);
  const loadHistory = useTaskChatStore((s) => s.loadHistory);
  const renameSession = useTaskChatStore((s) => s.renameSession);
  const turns = chat?.turns ?? [];
  const sessions = chat?.sessions ?? [];
  const streaming = chat?.streaming ?? false;
  const side = chat?.side ?? 'windows';
  const error = chat?.error;
  const usage = chat?.usage;
  const currentSessionId = chat?.sessionId;

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  // 历史会话重命名:editingSessionId 标记当前编辑项,draftSessionTitle 是输入框临时值
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftSessionTitle, setDraftSessionTitle] = useState('');

  // 打开历史面板时拉取会话列表
  useEffect(() => {
    if (historyOpen) void loadSessions(taskId);
  }, [historyOpen, taskId, loadSessions]);

  const onSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    void send(taskId, text);
  };

  const onStop = () => stop(taskId);

  const onCopyTurn = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板写入失败静默忽略
    }
  };

  // 复制当前会话的终端恢复指令(方便在终端 claude --resume <id> 接着聊)
  const onCopySessionId = async () => {
    if (!currentSessionId) return;
    try {
      await navigator.clipboard.writeText(`claude --resume ${currentSessionId}`);
      toast.success('已复制恢复指令');
    } catch {
      toast.error('复制失败');
    }
  };

  // 历史会话重命名:空标题或未改动不发请求
  const startRenameSession = (sessionId: string, title: string) => {
    setEditingSessionId(sessionId);
    setDraftSessionTitle(title);
  };
  const commitRenameSession = async (sessionId: string, fallback: string) => {
    const next = draftSessionTitle.trim();
    setEditingSessionId(null);
    if (!next || next === fallback) return;
    await renameSession(taskId, sessionId, next);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 右上角:当前会话 ID(可复制,便于终端 claude --resume)+ 历史会话入口 */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        {currentSessionId && (
          <button
            type="button"
            onClick={onCopySessionId}
            className="bg-background/80 hover:bg-background inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10px] backdrop-blur transition-colors"
            title={`会话 ID:${currentSessionId}\n点击复制恢复指令`}
          >
            <span className="text-muted-foreground">{currentSessionId.slice(0, 8)}</span>
            <Copy className="text-muted-foreground size-3" />
          </button>
        )}
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={streaming}
              className={cn(
                'bg-background/80 text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] backdrop-blur transition-colors data-[state=open]:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
              )}
              title="历史会话"
            >
              <History className="size-3.5" />
              历史
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="max-h-[60vh] w-72 overflow-y-auto p-1">
            {sessions.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-xs">该仓库下暂无历史会话</div>
            ) : (
              sessions.map((s) => {
                const isActive = s.sessionId === currentSessionId;
                const isEditing = editingSessionId === s.sessionId;
                return (
                  <div
                    key={s.sessionId}
                    className={cn(
                      'hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left',
                      isActive && 'bg-accent ring-primary/40 ring-1',
                    )}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draftSessionTitle}
                        onChange={(e) => setDraftSessionTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitRenameSession(s.sessionId, s.title);
                          } else if (e.key === 'Escape') {
                            setEditingSessionId(null);
                          }
                        }}
                        onBlur={() => void commitRenameSession(s.sessionId, s.title)}
                        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded border px-1 py-0.5 text-xs outline-none focus-visible:ring-[3px]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void loadHistory(taskId, s.sessionId, s.source ?? 'windows');
                          setHistoryOpen(false);
                        }}
                        className="flex w-full items-center gap-1"
                        title={isActive ? '当前会话' : undefined}
                      >
                        <span className="w-full truncate text-xs font-medium">{s.title || '(无标题)'}</span>
                        {isActive && <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                      </button>
                    )}
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="text-muted-foreground text-[10px]">
                        {new Date(s.lastActiveAt).toLocaleString()} · {s.messageCount} 条 ·{' '}
                        {s.source === 'wsl' ? 'WSL' : 'Windows'}
                      </span>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenameSession(s.sessionId, s.title || '');
                          }}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title="重命名"
                          aria-label="重命名"
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* 消息流(渲染抽到 MessageStream,与项目对话共用) */}
      <MessageStream
        turns={turns}
        streaming={streaming}
        error={error}
        usage={usage}
        onCopyTurn={onCopyTurn}
        emptyHint={
          <div className="text-muted-foreground py-8 text-center text-sm">
            在这里和 Claude 聊这个任务。它会以任务的仓库为工作目录,可读写文件、跑命令。
          </div>
        }
      />

      {/* 输入框 */}
      <div className="border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送 / Shift+Enter 换行(行业默认,对齐 Cursor/Cline/multica)
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
          <div className="flex items-center gap-2">
            {/* 侧切换:Windows / WSL claude(两套独立 session 池) */}
            <div className="bg-muted inline-flex rounded-md p-0.5">
              {(['windows', 'wsl'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={streaming}
                  onClick={() => setSide(taskId, s)}
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
            <span className="text-muted-foreground/60 text-[11px]">
              {usage ? `· 输入 ${usage.input_tokens.toLocaleString()} / 输出 ${usage.output_tokens.toLocaleString()}` : ''}
            </span>
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
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
