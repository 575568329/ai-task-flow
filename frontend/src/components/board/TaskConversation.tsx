// frontend/src/components/board/TaskConversation.tsx
// 任务对话 tab 的内容:消息流(turns 渲染)+ 输入框。
// 交互细节借鉴 multica + 线上产品(见知识库「AI 对话流式交互细节调研」):
// - Enter 发送 / Shift+Enter 换行(行业默认)
// - 发送键运行时变「停止」(AbortController → 后端 kill claude 子进程)
// - 流式态「思考中…」放消息流内(不压在按钮上)
// - 自动滚动:仅当用户靠近底部时跟随(上翻看历史不被拉回)
// - assistant 过程(thinking/tool_use)折叠成「N steps」,完成自动收,最终答案突出
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Copy, History } from 'lucide-react';
import { MessageContent } from '@/components/chat/MessageContent';
import { Textarea } from '@/components/ui/textarea';
import { Collapse } from '@/components/ui/collapse';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTaskChatStore, type Block, type Turn } from '@/stores/taskChatStore';
import { ThinkingCard } from './ThinkingCard';
import { ToolUseCard } from './ToolUseCard';
import { cn } from '@/lib/utils';

interface TaskConversationProps {
  taskId: string;
}

const NEAR_BOTTOM_THRESHOLD = 120; // 距底部 120px 内算「在底部」(对齐 multica atBottomThreshold)

/** 把 assistant 一轮的 blocks 切成 preface / middle / final(借鉴 multica splitTimeline):
 *  非文本块(thinking/tool_use)视为「过程」,首末过程之间的全部为 middle,其前为 preface、其后为 final。 */
function splitBlocks(blocks: Block[]): { preface: Block[]; middle: Block[]; final: Block[] } {
  const firstNonText = blocks.findIndex((b) => b.kind !== 'text');
  if (firstNonText === -1) return { preface: blocks, middle: [], final: [] };
  let lastNonText = firstNonText;
  for (let i = blocks.length - 1; i > firstNonText; i--) {
    if (blocks[i].kind !== 'text') {
      lastNonText = i;
      break;
    }
  }
  return {
    preface: blocks.slice(0, firstNonText),
    middle: blocks.slice(firstNonText, lastNonText + 1),
    final: blocks.slice(lastNonText + 1),
  };
}

/** 过程折叠:流式时展开,完成自动收(借鉴 multica OuterProcessFold) */
function ProcessFold({ blocks, streaming }: { blocks: Block[]; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  const stepCount = blocks.filter((b) => b.kind !== 'text').length;
  return (
    <div className="border-border bg-muted/20 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-muted-foreground"
      >
        <span className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>▸</span>
        <span>{streaming ? `进行中 · ${stepCount} 步` : `${stepCount} 个步骤`}</span>
      </button>
      <Collapse open={open}>
        <div className="space-y-1.5 border-t px-2 py-2">
          {blocks.map((b, i) => {
            // key 稳定唯一:tool_use 用其 id,其余用 kind+序号(禁止裸数组下标,CLAUDE.md 4.2)
            const key = b.kind === 'tool_use' ? b.id : `${b.kind}-${i}`;
            if (b.kind === 'text') {
              return (
                <div key={key} className="text-muted-foreground text-xs">
                  <MessageContent content={b.text} />
                </div>
              );
            }
            if (b.kind === 'thinking') return <ThinkingCard key={key} thinking={b.thinking} />;
            return (
              <ToolUseCard key={key} id={b.id} name={b.name} input={b.input} result={b.result} />
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}

/** 渲染一个 assistant 轮:preface → 过程折叠 → final(最终答案突出) */
function AssistantTurn({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  const blocks = turn.blocks ?? [];
  const { preface, middle, final } = splitBlocks(blocks);
  return (
    <div className="max-w-full space-y-2">
      {preface.map((b, i) =>
        b.kind === 'text' ? <MessageContent key={`text-${i}`} content={b.text} /> : null,
      )}
      {middle.length > 0 && <ProcessFold blocks={middle} streaming={streaming} />}
      {final.map((b, i) =>
        b.kind === 'text' ? <MessageContent key={`text-${i}`} content={b.text} /> : null,
      )}
      {blocks.length === 0 && streaming && <ThinkingIndicator />}
    </div>
  );
}

/** 「思考中…」内联指示(三个点呼吸动画),不压在发送按钮上 */
function ThinkingIndicator() {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 py-1 text-sm">
      <span>思考中</span>
      <span className="flex gap-0.5">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
    </div>
  );
}

export function TaskConversation({ taskId }: TaskConversationProps) {
  const chat = useTaskChatStore((s) => s.chats[taskId]);
  const send = useTaskChatStore((s) => s.send);
  const stop = useTaskChatStore((s) => s.stop);
  const setSide = useTaskChatStore((s) => s.setSide);
  const loadSessions = useTaskChatStore((s) => s.loadSessions);
  const loadHistory = useTaskChatStore((s) => s.loadHistory);
  const turns = chat?.turns ?? [];
  const sessions = chat?.sessions ?? [];
  const streaming = chat?.streaming ?? false;
  const side = chat?.side ?? 'windows';
  const error = chat?.error;
  const usage = chat?.usage;

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户是否靠近底部:只在靠近底部时自动跟随滚动(上翻看历史不被拉回)
  const nearBottomRef = useRef(true);

  // 打开历史面板时拉取会话列表
  useEffect(() => {
    if (historyOpen) void loadSessions(taskId);
  }, [historyOpen, taskId, loadSessions]);

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // turns 变化时:仅在靠近底部才跟随
  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom(turns.length > 0);
  }, [turns, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < NEAR_BOTTOM_THRESHOLD;
  };

  const onSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    nearBottomRef.current = true;
    void send(taskId, text);
  };

  const onStop = () => stop(taskId);

  const onCopyLast = async () => {
    // 复制最后一条 assistant 的纯文本
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息流 */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="text-muted-foreground py-8 text-center text-sm">
            在这里和 Claude 聊这个任务。它会以任务的仓库为工作目录,可读写文件、跑命令。
          </div>
        )}
        {turns.map((t, i) => {
          const isLast = i === turns.length - 1;
          if (t.role === 'user') {
            return (
              <div key={t.id} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm">
                  {t.text}
                </div>
              </div>
            );
          }
          return (
            <div key={t.id} className="space-y-1.5">
              <AssistantTurn turn={t} streaming={streaming && isLast} />
              {/* 终态 footer:耗时 + 复制(非流式才显示复制) */}
              {!streaming && (
                <div className="text-muted-foreground/70 flex items-center gap-2 text-[11px]">
                  {usage && typeof usage.duration_ms === 'number' && (
                    <span>用时 {(usage.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                  <button
                    type="button"
                    onClick={onCopyLast}
                    className="hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
                    title="复制回复"
                  >
                    <Copy className="size-3" />
                    复制
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>

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
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={streaming}
                  className={cn(
                    'text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] transition-colors data-[state=open]:text-foreground disabled:opacity-50',
                  )}
                  title="历史会话"
                >
                  <History className="size-3.5" />
                  历史
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-72 p-1">
                {sessions.length === 0 ? (
                  <div className="text-muted-foreground p-3 text-center text-xs">该仓库下暂无历史会话</div>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => {
                        void loadHistory(taskId, s.sessionId, s.source ?? 'windows');
                        setHistoryOpen(false);
                      }}
                      className="hover:bg-accent focus:bg-accent flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none"
                    >
                      <span className="w-full truncate text-xs font-medium">{s.title || '(无标题)'}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {new Date(s.lastActiveAt).toLocaleString()} · {s.messageCount} 条 ·{' '}
                        {s.source === 'wsl' ? 'WSL' : 'Windows'}
                      </span>
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
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
