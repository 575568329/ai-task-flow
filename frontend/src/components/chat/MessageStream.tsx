// frontend/src/components/chat/MessageStream.tsx
// 对话消息流渲染:turns → user 气泡 / assistant 归一化 blocks。
// 性能:浏览器原生 content-visibility:auto —— 屏幕外 turn 跳过布局/绘制(原生虚拟化),
//   几百上千条不卡;不卸载 DOM(保留滚动位置/组件状态),对不定高消息无需测高、无绝对定位抖动。
//   配合 TurnRow memo(applyChatEvent 对未变 turn 保持引用),流式仅末尾 turn 重渲。
// 保留交互:自动滚底(nearBottom 判断)、流式占位、过程折叠、终态 footer、复制、错误、空态。
// taskChat(TaskConversation)与 projectChat(ConversationPanel)共用。
import { memo, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Copy } from 'lucide-react';
import { MessageContent } from '@/components/chat/MessageContent';
import { Collapse } from '@/components/ui/collapse';
import { ThinkingCard } from '@/components/board/ThinkingCard';
import { ToolUseCard } from '@/components/board/ToolUseCard';
import { cn } from '@/lib/utils';
import type { ChatBlock, ChatTurn } from '@ai-task-flow/shared';

const NEAR_BOTTOM_THRESHOLD = 120;
// content-visibility 屏幕外占位估计高度:'auto' 前缀让浏览器记住曾渲染过的真实高度,避免滚动条抖动
const TURN_INTRINSIC_SIZE = 'auto 120px';
// 屏幕外 turn 的容器样式:content-visibility:auto 跳过渲染,containIntrinsicSize 提供占位尺寸
const turnContainerStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: TURN_INTRINSIC_SIZE,
};

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

function ThinkingIndicator() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
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
  usage?: MessageStreamUsage;
  emptyHint?: ReactNode;
  onCopyLast?: () => void;
}

/** 单 turn 渲染(memo):applyChatEvent 对未变 turn 保持引用,流式时仅末尾 turn 重渲 */
const TurnRow = memo(function TurnRow({
  turn,
  isLast,
  streaming,
  usage,
  onCopyLast,
}: {
  turn: ChatTurn;
  isLast: boolean;
  streaming: boolean;
  usage?: MessageStreamUsage;
  onCopyLast?: () => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <AssistantTurn turn={turn} streaming={streaming && isLast} />
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
});

export function MessageStream({ turns, streaming, error, usage, emptyHint, onCopyLast }: MessageStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // 末尾是 user turn = 用户刚发送,强制跟随;否则仅 nearBottom 时跟随
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last?.role === 'user') nearBottomRef.current = true;
    if (nearBottomRef.current && turns.length > 0) {
      const el = scrollRef.current;
      if (!el) return;
      const raf = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [turns, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < NEAR_BOTTOM_THRESHOLD;
  };

  const lastIsUser = turns.length === 0 || turns[turns.length - 1]?.role === 'user';

  if (turns.length === 0) {
    return (
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {emptyHint ?? <div className="text-muted-foreground py-8 text-center text-sm">在这里和 Claude 对话。</div>}
        {streaming && lastIsUser && <ThinkingIndicator />}
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
      <div className="space-y-4">
        {turns.map((t, i) => (
          /* content-visibility:auto 让屏幕外 turn 跳过布局/绘制(原生虚拟化),不卸载 DOM */
          <div key={t.id} style={turnContainerStyle}>
            <div className="py-2">
              <TurnRow
                turn={t}
                isLast={i === turns.length - 1}
                streaming={streaming}
                usage={usage}
                onCopyLast={onCopyLast}
              />
            </div>
          </div>
        ))}
      </div>
      {/* 流式占位 + 错误:列表之后,nearBottom 时可见 */}
      {streaming && lastIsUser && <ThinkingIndicator />}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  );
}
