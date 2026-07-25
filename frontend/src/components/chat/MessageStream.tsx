// frontend/src/components/chat/MessageStream.tsx
// 对话消息流渲染:turns → user 气泡 / assistant 归一化 blocks + 自动滚动 + 流式「思考中」占位 + 空态 + 终态 footer。
// 任务对话(TaskConversation)与项目对话(ConversationPanel)共用,从 TaskConversation 抽取。
// 交互细节借鉴 multica + 线上产品(见知识库「AI 对话流式交互细节调研」)。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { MessageContent } from '@/components/chat/MessageContent';
import { Collapse } from '@/components/ui/collapse';
import { ThinkingCard } from '@/components/board/ThinkingCard';
import { ToolUseCard } from '@/components/board/ToolUseCard';
import { cn } from '@/lib/utils';
import type { ChatBlock, ChatTurn } from '@ai-task-flow/shared';

const NEAR_BOTTOM_THRESHOLD = 120; // 距底部 120px 内算「在底部」

/** 把 assistant 一轮的 blocks 切成 preface / middle / final(借鉴 multica splitTimeline):
 *  非文本块(thinking/tool_use)视为「过程」,首末过程之间为 middle,其前 preface、其后 final。 */
function splitBlocks(blocks: ChatBlock[]): { preface: ChatBlock[]; middle: ChatBlock[]; final: ChatBlock[] } {
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
function ProcessFold({ blocks, streaming }: { blocks: ChatBlock[]; streaming: boolean }) {
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
            const key = b.kind === 'tool_use' ? b.id : `${b.kind}-${i}`;
            if (b.kind === 'text') {
              return (
                <div key={key} className="text-muted-foreground text-xs">
                  <MessageContent content={b.text} />
                </div>
              );
            }
            if (b.kind === 'thinking') return <ThinkingCard key={key} thinking={b.thinking} />;
            return <ToolUseCard key={key} id={b.id} name={b.name} input={b.input} result={b.result} />;
          })}
        </div>
      </Collapse>
    </div>
  );
}

/** 渲染一个 assistant 轮:preface → 过程折叠 → final(最终答案突出) */
function AssistantTurn({ turn, streaming }: { turn: ChatTurn; streaming: boolean }) {
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

/** 「思考中…」内联指示(三个点呼吸动画 + 已用时长) */
function ThinkingIndicator() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // 即便 claude 思考阶段不发中间事件,用户也能看到「还在工作、已 N 秒」,而非空白
    const start = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 py-1 text-sm">
      <span>思考中</span>
      <span className="flex gap-0.5">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      {seconds > 0 && <span className="text-[10px] tabular-nums">已 {seconds}s</span>}
    </div>
  );
}

export interface MessageStreamUsage {
  duration_ms?: number;
}

interface MessageStreamProps {
  turns: ChatTurn[];
  streaming: boolean;
  error?: string;
  /** 终态用量(显示用时);由调用方从 store 的 usage 传入 */
  usage?: MessageStreamUsage;
  /** 空态提示;默认通用文案 */
  emptyHint?: ReactNode;
  /** 复制最后一条 assistant 文本(footer 复制按钮);不传则不显示复制 */
  onCopyLast?: () => void;
}

/**
 * 对话消息流:自动滚动(仅靠近底部跟随,上翻看历史不被拉回)+ 流式占位 + 空态 + 终态 footer。
 * 用户发送(末尾变 user turn)时强制滚到底,确保看到自己刚发的消息。
 */
export function MessageStream({ turns, streaming, error, usage, emptyHint, onCopyLast }: MessageStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    // 末尾是 user turn = 用户刚发送,强制跟随到底(替代原 TaskConversation onSend 里置 nearBottom=true)
    const last = turns[turns.length - 1];
    if (last?.role === 'user') nearBottomRef.current = true;
    if (nearBottomRef.current) scrollToBottom(turns.length > 0);
  }, [turns, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < NEAR_BOTTOM_THRESHOLD;
  };

  const lastIsUser = turns.length === 0 || turns[turns.length - 1]?.role === 'user';

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {turns.length === 0 &&
        (emptyHint ?? (
          <div className="text-muted-foreground py-8 text-center text-sm">在这里和 Claude 对话。</div>
        ))}
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
            {/* 终态 footer:耗时 + 复制(非流式才显示) */}
            {!streaming && (
              <div className="text-muted-foreground/70 flex items-center gap-2 text-[11px]">
                {usage && typeof usage.duration_ms === 'number' && (
                  <span>用时 {(usage.duration_ms / 1000).toFixed(1)}s</span>
                )}
                {onCopyLast && (
                  <button
                    type="button"
                    onClick={onCopyLast}
                    className="hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
                    title="复制回复"
                  >
                    <Copy className="size-3" />
                    复制
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* 发送后→首个 assistant 事件前的空白期:streaming 且末尾仍是用户消息时,
          立即补「思考中」占位(消除空白感)。收到首个 assistant 事件后由 AssistantTurn 内部指示器接管 */}
      {streaming && lastIsUser && <ThinkingIndicator />}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  );
}
