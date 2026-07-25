// frontend/src/components/floating/ConversationPanel.tsx
// 项目对话视图(悬浮窗右栏):顶栏(对话名/关联任务/会话ID/侧切换)+ 消息流 + 输入框。
// 历史切换与新建已移至左栏 SessionList,本组件不再持有历史 Popover / 顶栏新建入口。
// 数据源为 projectChatStore 的「当前激活项目的记忆对话」(派生 current)。
import { ArrowUp, Square, Copy } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { MessageStream } from '@/components/chat/MessageStream';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

export function ConversationPanel() {
  const current = useProjectChatStore((s) =>
    s.activeRepoPath ? s.conversations[s.activeRepoPath] : undefined,
  );
  const projectsLoading = useProjectChatStore((s) => s.projectsLoading);
  const send = useProjectChatStore((s) => s.send);
  const stop = useProjectChatStore((s) => s.stop);
  const setSide = useProjectChatStore((s) => s.setSide);
  const setDraft = useProjectChatStore((s) => s.setDraft);

  // 无激活项目(projects 未加载/为空)时给提示,而非渲染空对话框
  if (!current) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
        {projectsLoading ? '加载项目…' : '暂无项目(先在某个仓库里建过任务才会有)'}
      </div>
    );
  }

  const { turns, streaming, error, usage, side, sessionId, title, taskTitle, repoPath, loading, draft } = current;
  // 受控输入绑定 per-project 草稿:切项目自动切到该项目的草稿,不串项目
  const input = draft ?? '';

  const onSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setDraft(repoPath, '');
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

  // 复制当前会话的终端恢复指令(方便在对应侧终端 claude --resume <id> 接着聊)
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
      {/* 顶栏:对话标题 + 关联任务 + 会话ID(可复制)+ 侧切换(历史/新建已移至左栏 SessionList) */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
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
                title={`会话 ID:${sessionId}\n点击复制恢复指令(在对应侧终端运行)`}
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
              disabled={streaming || !!loading}
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

      {/* 消息流:历史会话加载中显示提示,否则渲染复用 MessageStream */}
      {loading ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-xs">
          加载历史会话…
        </div>
      ) : (
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
      )}

      {/* 输入框 */}
      <div className="border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setDraft(repoPath, e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送 / Shift+Enter 换行(与 TaskConversation 一致)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            loading
              ? '加载历史会话…'
              : streaming
                ? 'Claude 正在回复…(可点停止)'
                : '输入消息(Enter 发送,Shift+Enter 换行)'
          }
          disabled={streaming || !!loading}
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
              disabled={!input.trim() || !!loading}
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
